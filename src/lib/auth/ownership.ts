import { prisma } from "@/lib/prisma";

/**
 * Ids a request body points at, each of which must belong to the caller.
 *
 * A route scopes its own row by `userId`, but a body that names *another* row
 * (a project to file a task in, tags, a goal, a connected account) is a second
 * lookup the route has to make itself. Connecting an id Prisma only checks
 * exists, not whose it is, so a missed check writes into another user's data:
 * a task in their project, progress on their goal, a sync running on their
 * account's tokens.
 */
export interface OwnedRefs {
  projectId?: string | null;
  tagIds?: readonly string[] | null;
  goalId?: string | null;
  accountId?: string | null;
}

export type ForeignRef = keyof OwnedRefs;

/**
 * The first reference in `refs` that isn't the caller's (missing counts too),
 * or null when every one is theirs. Null/undefined references are skipped.
 */
export async function findForeignRef(
  userId: string,
  refs: OwnedRefs
): Promise<ForeignRef | null> {
  if (refs.projectId) {
    const n = await prisma.project.count({
      where: { id: refs.projectId, userId },
    });
    if (n === 0) return "projectId";
  }
  if (refs.tagIds && refs.tagIds.length > 0) {
    const ids = [...new Set(refs.tagIds)];
    const n = await prisma.tag.count({ where: { id: { in: ids }, userId } });
    if (n !== ids.length) return "tagIds";
  }
  if (refs.goalId) {
    const n = await prisma.goal.count({ where: { id: refs.goalId, userId } });
    if (n === 0) return "goalId";
  }
  if (refs.accountId) {
    const n = await prisma.connectedAccount.count({
      where: { id: refs.accountId, userId },
    });
    if (n === 0) return "accountId";
  }
  return null;
}

const NOT_FOUND: Record<ForeignRef, string> = {
  projectId: "Project not found",
  tagIds: "Tag not found",
  goalId: "Goal not found",
  accountId: "Account not found",
};

/** The 404 message for a foreign reference: it reads as missing, not forbidden. */
export function foreignRefMessage(ref: ForeignRef): string {
  return NOT_FOUND[ref];
}
