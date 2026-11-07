import { Prisma } from "@prisma/client";

import { SELF_RELATION_FIELDS, exportedModels } from "./models";

/**
 * Deterministic insert order for exported models: a model after every model
 * it references via a scalar FK. Self-relations are excluded (imported null,
 * then patched). Ties break alphabetically.
 */
export function insertOrder(models: string[] = exportedModels()): string[] {
  const set = new Set(models);
  const deps = new Map<string, Set<string>>();
  for (const name of models) {
    deps.set(name, new Set());
  }

  for (const entry of Prisma.dmmf.datamodel.models) {
    if (!set.has(entry.name)) continue;
    const selfField = SELF_RELATION_FIELDS[entry.name];
    for (const field of entry.fields) {
      if (field.kind !== "object") continue;
      const from = field.relationFromFields ?? [];
      if (from.length === 0) continue;
      if (selfField && from.includes(selfField)) continue;
      if (field.type === entry.name) continue;
      if (!set.has(field.type)) continue;
      // User is never exported; userId is rewritten on import.
      if (field.type === "User") continue;
      deps.get(entry.name)!.add(field.type);
    }
  }

  const remaining = new Set(models);
  const ordered: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((name) => [...deps.get(name)!].every((d) => !remaining.has(d)))
      .sort((a, b) => a.localeCompare(b));
    if (ready.length === 0) {
      throw new Error(
        `Cycle in export model graph among: ${[...remaining].sort().join(", ")}`
      );
    }
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
    }
  }

  return ordered;
}

/** Erase deletes in reverse insert order. */
export function eraseOrder(models?: string[]): string[] {
  return insertOrder(models).slice().reverse();
}

/** Self-relation field names excluded from the topological sort. */
export function selfRelationFields(): Record<string, string> {
  return { ...SELF_RELATION_FIELDS };
}
