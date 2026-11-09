/**
 * What goals can claim Code's work by: a repo (`repo:<owner>/<name>`), or
 * everything under an owner, a GitHub user or organization
 * (`owner:<owner>`). Keys are lowercase, like the repos they name.
 */
import type { Db, DbTransaction } from "@/lib/prisma";

import type { ClaimOption } from "@/modules/types";

import { CODE_SOURCE } from "./worklog";

/** Repos that only live on one machine are sent as `local/<folder>`; there's no owner to claim. */
const LOCAL_OWNER = "local";

export function repoClaimKeys(repo: string): string[] {
  const owner = repo.split("/")[0];
  return [`repo:${repo}`, ...(owner && owner !== LOCAL_OWNER ? [`owner:${owner}`] : [])];
}

export async function codeClaimKeys(
  db: Db | DbTransaction,
  userId: string,
  taskIds: string[]
): Promise<Map<string, string[]>> {
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds }, userId, source: CODE_SOURCE, externalListId: { not: null } },
    select: { id: true, externalListId: true },
  });
  return new Map(tasks.map((t) => [t.id, repoClaimKeys(t.externalListId!)] as const));
}

/** Every repo Code has seen, and each owner with more than one of them. */
export async function codeClaimOptions(db: Db, userId: string): Promise<ClaimOption[]> {
  const rows = await db.task.findMany({
    where: { userId, source: CODE_SOURCE, externalListId: { not: null } },
    select: { externalListId: true },
    distinct: ["externalListId"],
    orderBy: { externalListId: "asc" },
  });
  const repos = rows.map((r) => r.externalListId!);
  const owners = new Map<string, number>();
  for (const repo of repos) {
    const owner = repo.split("/")[0];
    if (owner !== LOCAL_OWNER) owners.set(owner, (owners.get(owner) ?? 0) + 1);
  }
  return [
    ...[...owners].flatMap(([owner, count]) =>
      count > 1
        ? [{ key: `owner:${owner}`, label: `${owner}/*`, title: `Every repo under ${owner} (${count} so far)` }]
        : []
    ),
    // A repo goes by its name ("mahoraga") unless another owner has one by the same name.
    ...repos.map((repo) => {
      const name = repo.split("/")[1];
      const shared = repos.filter((r) => r.split("/")[1] === name).length > 1;
      return { key: `repo:${repo}`, label: shared ? repo : name, title: `Every day you commit to ${repo}` };
    }),
  ];
}
