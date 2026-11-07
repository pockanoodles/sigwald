// Loads every module of the compiled worker (`npm run build:worker` → dist/) under
// plain Node, the way the worker runs in production. Jest transforms modules and
// `next build` bundles them, so neither notices a dependency plain Node can't
// require: on 2026-11-07 sanitize-html 2.18 passed both and failed only in the
// worker (ERR_REQUIRE_ESM on Node 20.14). CI and the deploy run this after the
// worker build.
//
// The entry points are skipped: worker.js starts the sync loop and load-env.js
// reads .env. Nothing here connects to a database; Prisma connects on first query.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dist = path.resolve(process.argv[2] ?? "dist");
const require = createRequire(path.join(dist, "noop.js"));
const skip = new Set(["worker/worker.js", "worker/load-env.js"]);

if (!fs.existsSync(path.join(dist, "worker", "register-alias.js"))) {
  console.error(`check-worker-requires: no worker build in ${dist}; run npm run build:worker first`);
  process.exit(1);
}
require("./worker/register-alias.js");

const files = fs
  .readdirSync(dist, { recursive: true })
  .filter((f) => f.endsWith(".js") && !skip.has(f.split(path.sep).join("/")))
  .sort();

const failures = [];
for (const file of files) {
  try {
    require("./" + file);
  } catch (error) {
    failures.push(`${file}: ${error.code ?? ""} ${String(error.message).split("\n")[0]}`);
  }
}

if (failures.length) {
  console.error(`check-worker-requires: ${failures.length} of ${files.length} modules fail to load under Node ${process.version}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check-worker-requires: ${files.length} worker modules load under Node ${process.version}`);
process.exit(0); // Prisma or timers pulled in by a module must not keep CI waiting
