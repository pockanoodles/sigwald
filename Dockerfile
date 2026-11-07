# Base stage for both development and production
FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install netcat
RUN apk add --no-cache netcat-openbsd

# Development stage
FROM base AS development
WORKDIR /app
ENV NODE_ENV=development
COPY . .
COPY package*.json ./
RUN npm install --legacy-peer-deps --ignore-scripts
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
# Listen on all interfaces so host port mapping works (default localhost-only breaks Docker)
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# Production builder stage
FROM base AS builder
WORKDIR /app
COPY . .
COPY package*.json ./
# --include=dev: base sets NODE_ENV=production, which makes npm skip
# devDependencies — but the build's type-check needs @types/* and eslint.
RUN npm ci --legacy-peer-deps --ignore-scripts --include=dev
# Fail fast if the build context omitted app source (mis-set context → tiny image, missing @/ imports)
RUN test -f src/components/focus/FocusMode.tsx \
  && test -f "src/app/(common)/layout.tsx"
# Generate the Prisma client first — `npm ci --ignore-scripts` skips the
# postinstall generate, and `next build` type-checks against the client.
RUN npm run prisma:generate
RUN SIGWALD_STANDALONE=1 npm run build
# The sync worker, one bundled file (everything but the Prisma client inlined),
# so the production image runs it without the source or the full node_modules.
RUN npm run build:worker

# Production stage
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/dist/worker ./dist/worker
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI + engines so the entrypoint's `npx prisma generate/migrate deploy`
# resolves locally instead of downloading on every container start.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/prisma ./prisma
COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh
# Prove the worker starts against this image's node_modules, not the builder's.
COPY --from=builder /app/scripts/check-worker-bundle.mjs /tmp/
RUN node /tmp/check-worker-bundle.mjs dist/worker/worker.js && rm /tmp/check-worker-bundle.mjs

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"] 
