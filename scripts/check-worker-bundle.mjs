// Starts the bundled worker (`npm run build:worker` → dist/worker/worker.js)
// under plain Node for a few seconds, the way production runs it, and fails if
// it dies first. Jest transforms modules and `next build` bundles the app, so
// neither notices a module the worker can't load: on 2026-11-07 sanitize-html
// 2.18 passed both and failed only in the worker (ERR_REQUIRE_ESM).
//
// The database URL points at a closed port, so nothing is read or written:
// a load failure throws at start, long before the first sync tick.
//
// Usage: node scripts/check-worker-bundle.mjs [path/to/worker.js]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const bundle = path.resolve(process.argv[2] ?? "dist/worker/worker.js");
const ALIVE_MS = 4_000;

if (!fs.existsSync(bundle)) {
  console.error(`check-worker-bundle: no ${bundle}; run npm run build:worker first`);
  process.exit(1);
}

const child = spawn(process.execPath, [bundle], {
  cwd: path.dirname(bundle), // no .env there, so only the values below apply
  env: {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://check:check@127.0.0.1:1/check",
    SIGWALD_SECRET_KEY: randomBytes(32).toString("hex"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));

const timer = setTimeout(() => {
  child.kill("SIGKILL");
  console.log(`check-worker-bundle: worker loaded and ran ${ALIVE_MS / 1000}s under Node ${process.version}`);
  process.exit(0);
}, ALIVE_MS);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  console.error(`check-worker-bundle: worker exited early (code ${code}, signal ${signal})\n${output}`);
  process.exit(1);
});
