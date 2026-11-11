/**
 * The module boundary, enforced. Code outside a module may reach it only
 * through the registries (src/modules/{index,client,server,hooks}.ts); a
 * module's own route files under src/app belong to it.
 *
 * A coupling that has to exist for a while goes in KNOWN with what removes
 * it, and the list can only shrink: a new coupling fails this test, and so
 * does a listed one that's gone (delete its line).
 */
import fs from "node:fs";
import path from "node:path";

/** What each module owns, by path prefix. Courses and Ladder predate src/modules. */
const OWNED: Record<string, string[]> = {
  courses: [
    "src/modules/courses/",
    "src/components/courses/",
    "src/components/packet/",
    "src/components/settings/CanvasLmsSettings.tsx",
    "src/lib/canvas/",
    "src/lib/sigwald/gradebook.ts",
    "src/lib/sigwald/grade-projection.ts",
    "src/lib/sigwald/load-grade-projections.ts",
    "src/store/courseLibrary.ts",
    "src/store/courseActivity.ts",
    "src/types/course-activity.ts",
    "src/types/course-materials.ts",
    "src/types/gradebook.ts",
    "src/app/(common)/courses/",
    "src/app/api/sigwald/canvas/",
    "src/app/api/sigwald/corrections/",
    "src/app/api/sigwald/courses/",
    "src/app/api/sigwald/grades/",
    "src/app/api/sigwald/materials/",
    "src/app/api/sigwald/news/",
    "src/app/api/sigwald/activity/",
    "src/app/api/sigwald/tasks/[id]/materials/",
  ],
  ladder: [
    "src/modules/ladder/",
    "src/components/ladder/",
    "src/components/goals/",
    "src/lib/sigwald/boss-proof.ts",
    "src/lib/sigwald/goal-cycles.ts",
    "src/lib/sigwald/goal-input.ts",
    "src/lib/sigwald/goal-links.ts",
    "src/lib/sigwald/goal-plans.ts",
    "src/lib/sigwald/goal-rules.ts",
    "src/lib/sigwald/hex.ts",
    "src/lib/sigwald/ladder.ts",
    "src/lib/sigwald/stats.ts",
    "src/lib/sigwald/xp.ts",
    "src/lib/sigwald/xp-report.ts",
    "src/store/ladder.ts",
    "src/types/ladder.ts",
    "src/app/(common)/goals/",
    "src/app/api/sigwald/goals/",
    "src/app/api/sigwald/ladder/",
    "src/app/api/sigwald/cycles/",
    "src/app/api/sigwald/xp/",
    "src/app/api/sigwald/task-links/",
  ],
  people: [
    "src/modules/people/",
    "src/app/(common)/people/",
    "src/app/api/sigwald/people/",
  ],
  training: [
    "src/modules/training/",
    "src/app/(common)/training/",
    "src/app/api/sigwald/training/",
  ],
  nutrition: [
    "src/modules/nutrition/",
    "src/app/(common)/nutrition/",
    "src/app/api/sigwald/nutrition/",
  ],
  work: [
    "src/modules/work/",
    "src/app/(common)/work/",
    "src/app/api/sigwald/work/",
    "src/app/api/sigwald/shifts/",
  ],
  code: ["src/modules/code/", "src/app/api/sigwald/code/"],
  github: ["src/modules/github/"],
  linear: ["src/modules/linear/"],
  stripe: ["src/modules/stripe/"],
  daylight: ["src/modules/daylight/"],
  inbox: ["src/modules/inbox/", "src/app/api/sigwald/inbox/"],
  readouts: [
    "src/modules/readouts/",
    "src/app/(common)/readouts/",
    "src/app/api/sigwald/readouts/",
  ],
  deadlines: ["src/modules/deadlines/"],
  sheet: ["src/modules/sheet/"],
};

const REGISTRIES = new Set([
  "src/modules/index.ts",
  "src/modules/client.tsx",
  "src/modules/server.ts",
  "src/modules/hooks.ts",
]);

/**
 * "<importing file> -> <module>", each with what will remove it. Empty since
 * 2026-10-25: anything added here is a debt, written down with its way out.
 */
const KNOWN = new Set<string>([]);

const ROOT = path.resolve(__dirname, "../../..");
const IMPORT =
  /(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function ownerOf(file: string): string | null {
  for (const [id, prefixes] of Object.entries(OWNED)) {
    if (prefixes.some((p) => file === p || file.startsWith(p))) return id;
  }
  return null;
}

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("."))
    base = path.posix.join(path.posix.dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    const full = path.join(ROOT, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  return base;
}

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory())
        return e.name === "__tests__" ? [] : sourceFiles(rel);
      return /\.tsx?$/.test(e.name) ? [rel] : [];
    });
}

function couplings(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles("src")) {
    if (REGISTRIES.has(file)) continue;
    const mine = ownerOf(file);
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const target = resolve(m[1] ?? m[2], file);
      const theirs = target ? ownerOf(target) : null;
      if (theirs && theirs !== mine) found.add(`${file} -> ${theirs}`);
    }
  }
  return found;
}

describe("module boundary", () => {
  const found = couplings();

  it("has no new way into a module except the registries", () => {
    expect([...found].filter((c) => !KNOWN.has(c)).sort()).toEqual([]);
  });

  it("lists no coupling that's already gone (delete its line in KNOWN)", () => {
    expect([...KNOWN].filter((c) => !found.has(c)).sort()).toEqual([]);
  });
});
