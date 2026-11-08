/**
 * What counts as outstanding work, defined once so Focus, the attention list
 * and the course library never disagree.
 *
 * A source can close a task without anyone ticking it: Canvas closes an
 * assignment that locked without a submission (`missed`) or whose course
 * ended. The module records that as `closedAt` while `status` still reads
 * todo — a missed assignment is closed, not completed.
 */
import type { Prisma } from "@prisma/client";

import { visibleSourceWhere } from "@/modules/state";

/** Not done and not closed by its source. */
export function notClosedWhere(): Prisma.TaskWhereInput {
  return { status: { not: "completed" }, closedAt: null };
}

/**
 * Work someone can act on now: not closed, a top-level task, not deferred,
 * and already unlocked. `hidden` is the task sources of the modules this
 * person has off (`hiddenTaskSources`): that work is still stored, it just
 * isn't theirs to act on while the module is off.
 *
 * `deferredWithDue` also loads deferred tasks that have a due date, for a
 * caller that applies `deferralHides` itself: a deferral that ends after the
 * deadline doesn't hide the task. SQL can't read a date-only due the way
 * `dueBy` does, so that check runs in code.
 */
export function openWorkWhere(
  userId: string,
  now: Date,
  hidden: readonly string[] = [],
  { deferredWithDue = false }: { deferredWithDue?: boolean } = {}
): Prisma.TaskWhereInput {
  return {
    userId,
    parentTaskId: null,
    AND: [
      notClosedWhere(),
      {
        OR: [
          { postponedUntil: null },
          { postponedUntil: { lte: now } },
          ...(deferredWithDue ? [{ dueDate: { not: null } }] : []),
        ],
      },
      { OR: [{ unlockAt: null }, { unlockAt: { lte: now } }] },
      visibleSourceWhere(hidden),
    ],
  };
}
