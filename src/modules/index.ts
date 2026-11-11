import code from "@/modules/code/manifest";
import courses from "@/modules/courses/manifest";
import github from "@/modules/github/manifest";
import ladder from "@/modules/ladder/manifest";
import linear from "@/modules/linear/manifest";
import nutrition from "@/modules/nutrition/manifest";
import people from "@/modules/people/manifest";
import stripe from "@/modules/stripe/manifest";
import training from "@/modules/training/manifest";
import type {
  ClaimOption,
  ModuleId,
  ModuleManifest,
  ModuleState,
} from "@/modules/types";
import work from "@/modules/work/manifest";

/**
 * Every module this build ships, in catalog order: finished modules first,
 * then the ones still in beta. Plain data, so the rail, the server and
 * middleware can all import it. A module someone has never touched takes its
 * place in the rail from this order.
 */
export const MODULES: readonly ModuleManifest[] = [
  ladder,
  work,
  courses,
  people,
  training,
  nutrition,
  code,
  github,
  linear,
  stripe,
];

export function isModuleId(id: string): id is ModuleId {
  return MODULES.some((m) => m.id === id);
}

export function moduleById(id: ModuleId): ModuleManifest {
  const found = MODULES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown module: ${id}`);
  return found;
}

/** The module whose rail entry is this path, if any. */
export function moduleForPath(pathname: string): ModuleManifest | undefined {
  return MODULES.find(
    (m) =>
      m.page &&
      (pathname === m.page.href || pathname.startsWith(`${m.page.href}/`))
  );
}

/** The module that owns a task source ("CANVAS" → courses), if any. */
export function moduleForSource(
  source: string | null | undefined
): ModuleManifest | undefined {
  if (!source) return undefined;
  return MODULES.find((m) => m.sources.includes(source));
}

/** The whole sources modules let a goal claim ("All Canvas work"), in catalog order. */
export function sourceClaims(): ClaimOption[] {
  return MODULES.flatMap((m) =>
    Object.entries(m.claimLabels ?? {}).map(([key, label]) => ({
      key,
      label,
      title: `Every task ${m.name} adds`,
    }))
  );
}

interface ModuleRow {
  moduleId: string;
  enabled: boolean;
  position: number;
}

/**
 * Each module as one person has it: their row where they have one, the
 * module's default where they don't. Rows for modules this build no longer
 * ships are ignored. Sorted the way the rail lists them.
 */
export function resolveModuleStates(rows: readonly ModuleRow[]): ModuleState[] {
  return MODULES.map((m, index) => {
    const row = rows.find((r) => r.moduleId === m.id);
    return row
      ? { id: m.id, on: row.enabled, position: row.position }
      : { id: m.id, on: m.defaultOn, position: index };
  }).sort(
    (a, b) =>
      a.position - b.position ||
      MODULES.findIndex((m) => m.id === a.id) -
        MODULES.findIndex((m) => m.id === b.id)
  );
}

/** Task sources whose module is off: their tasks stay stored but leave every list. */
export function hiddenSourcesOf(states: readonly ModuleState[]): string[] {
  return states.filter((s) => !s.on).flatMap((s) => moduleById(s.id).sources);
}

/** Where a module turned on now goes: after everything already in the rail. */
export function nextPosition(states: readonly ModuleState[]): number {
  return states.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}
