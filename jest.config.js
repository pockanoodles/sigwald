/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  // No database and no log writes: see the file.
  setupFiles: ["<rootDir>/jest.setup.js"],

  // Transpile only. The full type-check runs once via `npm run type-check`;
  // doing it per worker made every worker instantiate Prisma's 2.6 MB
  // generated .d.ts in its own TypeScript program (~3.5 GB each).
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true }],
  },

  // Jest defaults to cpus-1 workers (9 here) and V8 allows each ~4.2 GB, i.e.
  // ~38 GB of sanctioned heap on a 16 GB machine. Cap both so a runaway test
  // fails the run instead of the machine.
  maxWorkers: 3,
  workerIdleMemoryLimit: "1GB",
};

module.exports = config;
