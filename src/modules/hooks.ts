/**
 * What the core asks of every module, and the events it raises for them to
 * hear (server only).
 */
import { logger } from "@/lib/logger";
import type { Db, DbTransaction } from "@/lib/prisma";
import type { SearchGroup, SearchQuery } from "@/lib/search/types";
import type { RankSignals } from "@/lib/sigwald/rank-stage1";

import { MODULES } from "@/modules";
import { type PullOutcome, runPull } from "@/modules/connect/run";
import {
  type FactsRequest,
  SERVER_MODULES,
  type TaskFacts,
} from "@/modules/server";
import type { ClaimOption, ModuleId, ProofItem } from "@/modules/types";

/**
 * Some of a person's tasks were created or changed (all of them when
 * `taskIds` is missing): each module gets to keep its own data in step —
 * Ladder links them to the goals that claim them. It runs whether or not a
 * module is on, so turning one back on finds its data consistent.
 */
export async function tasksChanged(
  db: Db | DbTransaction,
  userId: string,
  taskIds?: string[]
): Promise<void> {
  if (taskIds && taskIds.length === 0) return;
  for (const m of MODULES) {
    await SERVER_MODULES[m.id].afterTasksChange?.(db, userId, taskIds);
  }
}

/**
 * What the modules a person has on add to these tasks, merged per task.
 * Callers spread an entry onto its task without reading it.
 */
export async function moduleTaskFacts(
  db: Db,
  userId: string,
  tasks: FactsRequest[],
  isOn: (id: ModuleId) => boolean
): Promise<Map<string, TaskFacts>> {
  const merged = new Map<string, TaskFacts>();
  if (tasks.length === 0) return merged;
  for (const m of MODULES) {
    const ask = SERVER_MODULES[m.id].taskFacts;
    if (!ask || !isOn(m.id)) continue;
    for (const [id, facts] of await ask(db, userId, tasks)) {
      merged.set(id, { ...merged.get(id), ...facts });
    }
  }
  return merged;
}

/**
 * What the modules a person has on tell Focus's ranking about each task: the
 * strongest lift any of them gives it, and its stakes from the one that owns
 * it.
 */
export async function moduleRankSignals(
  db: Db,
  userId: string,
  taskIds: string[],
  isOn: (id: ModuleId) => boolean
): Promise<Map<string, RankSignals>> {
  const merged = new Map<string, RankSignals>();
  if (taskIds.length === 0) return merged;
  for (const m of MODULES) {
    const ask = SERVER_MODULES[m.id].rankSignals;
    if (!ask || !isOn(m.id)) continue;
    for (const [id, signals] of await ask(db, userId, taskIds)) {
      const had = merged.get(id);
      const lift =
        had?.lift != null && signals.lift != null
          ? Math.max(had.lift, signals.lift)
          : (signals.lift ?? had?.lift);
      merged.set(id, { ...had, ...signals, lift });
    }
  }
  return merged;
}

/** Every key a goal can claim each task by that a module supplies, on or off. */
export async function moduleClaimKeys(
  db: Db | DbTransaction,
  userId: string,
  taskIds: string[]
): Promise<Map<string, string[]>> {
  const keys = new Map<string, string[]>();
  if (taskIds.length === 0) return keys;
  for (const m of MODULES) {
    const ask = SERVER_MODULES[m.id].claimKeys;
    if (!ask) continue;
    for (const [id, more] of await ask(db, userId, taskIds)) {
      keys.set(id, [...(keys.get(id) ?? []), ...more]);
    }
  }
  return keys;
}

/**
 * What the modules keep that a boss can name as proof (these refs, or all of
 * them), on or off: a boss stays settled by its evidence while the module
 * that keeps it is turned off.
 */
export async function moduleProofItems(
  db: Db | DbTransaction,
  userId: string,
  refs?: string[]
): Promise<ProofItem[]> {
  if (refs && refs.length === 0) return [];
  const items: ProofItem[] = [];
  for (const m of MODULES) {
    const ask = SERVER_MODULES[m.id].proofItems;
    if (ask) items.push(...(await ask(db, userId, refs)));
  }
  return items;
}

/**
 * Every claim the modules offer goals beyond whole sources, on or off. Two
 * modules can offer the same key (Code and GitHub both offer a repo): the
 * first in catalog order names it.
 */
export async function moduleClaimOptions(
  db: Db,
  userId: string
): Promise<ClaimOption[]> {
  const options: ClaimOption[] = [];
  const keys = new Set<string>();
  for (const m of MODULES) {
    const ask = SERVER_MODULES[m.id].claimOptions;
    if (!ask) continue;
    for (const option of await ask(db, userId)) {
      if (keys.has(option.key)) continue;
      keys.add(option.key);
      options.push(option);
    }
  }
  return options;
}

/** A connector module's pull, run now ("Pull now"). Null for a module that isn't one. */
export async function pullModuleNow(
  userId: string,
  id: ModuleId
): Promise<PullOutcome | null> {
  const connector = SERVER_MODULES[id].connector;
  return connector
    ? runPull(userId, id, connector.pull, { force: true })
    : null;
}

/**
 * What the modules a person has on find for the top bar's search, in catalog
 * order. A module whose search fails drops out rather than failing the rest.
 */
export async function moduleSearch(
  db: Db,
  userId: string,
  q: SearchQuery,
  isOn: (id: ModuleId) => boolean
): Promise<SearchGroup[]> {
  const asked = MODULES.flatMap((m) => {
    const search = SERVER_MODULES[m.id].search;
    return search && isOn(m.id)
      ? [{ id: m.id, answer: search(db, userId, q) }]
      : [];
  });
  const answers = await Promise.allSettled(asked.map((a) => a.answer));
  return answers.flatMap((a, i) => {
    if (a.status === "fulfilled") return a.value;
    logger.error(
      "Module search failed",
      {
        module: asked[i].id,
        error: a.reason instanceof Error ? a.reason.message : String(a.reason),
      },
      "ModuleSearch"
    );
    return [];
  });
}
