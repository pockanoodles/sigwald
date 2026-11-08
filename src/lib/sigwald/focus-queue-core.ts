/**
 * Shared ranking pipeline for Focus queue and briefing (docs/focus-mode.md).
 * Modules weigh in through the registry: a lift before ranking (Ladder's
 * goals), facts after it (Courses' course and grade). Neither is read here.
 */
import type { Prisma } from "@prisma/client";

import { newDate } from "@/lib/date-utils";
import { prisma } from "@/lib/prisma";
import {
  computeSigwaldAvailabilitySummary,
  filterTasksByAvailabilityCapacity,
} from "@/lib/sigwald/availability";
import { computeFocusBriefing } from "@/lib/sigwald/briefing";
import { dueBy } from "@/lib/sigwald/due";
import { openWorkWhere } from "@/lib/sigwald/open-work";
import {
  type RankSignals,
  type Rest,
  type TaskForRanking,
  filterTasksForRanking,
  isDangerResolved,
  orderTasksStage1,
  restOf,
  stage1MetaForTasks,
} from "@/lib/sigwald/rank-stage1";
import { userTimeZone } from "@/lib/user-time-zone";

import { moduleRankSignals, moduleTaskFacts } from "@/modules/hooks";
import type { TaskFacts } from "@/modules/server";
import { moduleView } from "@/modules/state";

/**
 * A task as the ranking reads it. Its due date is the moment it's due by
 * (lib/sigwald/due.ts), so a date picked without a time counts until the end
 * of that day in `timeZone`.
 */
export function toTaskForRanking(
  r: {
    id: string;
    title: string;
    status: string;
    source: string | null;
    dueDate: Date | null;
    unlockAt: Date | null;
    lockAt: Date | null;
    duration: number | null;
    impact: number | null;
    closedAt: Date | null;
    priority: string | null;
    skipCount: number;
    lastSkippedAt: Date | null;
    createdAt: Date;
    postponedUntil?: Date | null;
    parentTaskId?: string | null;
  },
  timeZone: string,
  signals: RankSignals = {}
): TaskForRanking {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    dueDate: r.dueDate && dueBy(r.dueDate, r.source, timeZone),
    unlockAt: r.unlockAt,
    lockAt: r.lockAt,
    duration: r.duration,
    impact: r.impact,
    closedAt: r.closedAt,
    priority: r.priority,
    skipCount: r.skipCount,
    lastSkippedAt: r.lastSkippedAt,
    createdAt: r.createdAt,
    postponedUntil: r.postponedUntil ?? null,
    parentTaskId: r.parentTaskId ?? null,
    lift: signals.lift ?? null,
    stakes: signals.stakes ?? null,
    stakesGroup: signals.stakesGroup ?? null,
  };
}

export type FocusQueueTaskRow = Prisma.TaskGetPayload<{
  include: {
    tags: true;
    project: true;
    subtasks: {
      select: { id: true; title: true; status: true; order: true };
    };
  };
}>;

export interface FocusQueueCoreResult {
  rows: FocusQueueTaskRow[];
  /** What the modules add to each row, keyed by task id: spread it onto the row. */
  facts: Map<string, TaskFacts>;
  minimal: TaskForRanking[];
  filtered: TaskForRanking[];
  slotAware: TaskForRanking[];
  /** What to do next: tasks that fit the free slot, resting ones last (Focus, ops' top task). */
  ordered: TaskForRanking[];
  meta: ReturnType<typeof stage1MetaForTasks>;
  /**
   * Every open task in its place on its merits, whether it rests or fits the
   * free slot (Today). Nothing open is missing from it.
   */
  inventory: TaskForRanking[];
  inventoryMeta: ReturnType<typeof stage1MetaForTasks>;
  /** Which tasks rest (skipped or put off), and until when. */
  rests: Map<string, Rest>;
  availability: Awaited<ReturnType<typeof computeSigwaldAvailabilitySummary>>;
  slotMinutesForRank: number | null;
  /** The person's zone, which the due dates above were read in. */
  timeZone: string;
}

/**
 * Loads tasks, applies Stage 1 ranking with availability filtering.
 */
export async function buildFocusQueueCore(
  userId: string
): Promise<FocusQueueCoreResult> {
  const now = newDate();
  const [modules, timeZone] = await Promise.all([
    moduleView(userId),
    userTimeZone(prisma, userId),
  ]);

  const rows = await prisma.task.findMany({
    // Deferred tasks with a due date too: one due before its deferral ends
    // stays listed (filterTasksForRanking → deferralHides).
    where: openWorkWhere(userId, now, modules.hidden, {
      deferredWithDue: true,
    }),
    include: {
      tags: true,
      project: true,
      subtasks: {
        orderBy: { order: "asc" },
        select: { id: true, title: true, status: true, order: true },
      },
    },
  });

  const ids = rows.map((r) => r.id);
  const signals = await moduleRankSignals(prisma, userId, ids, modules.isOn);
  const minimal = rows.map((r) =>
    toTaskForRanking(r, timeZone, signals.get(r.id))
  );
  const filtered = filterTasksForRanking(minimal, now);

  const availability = await computeSigwaldAvailabilitySummary(userId, now);
  const slotAware = filterTasksByAvailabilityCapacity(
    filtered,
    availability.effectiveCapacityMinutes,
    availability.applyTaskDurationFilter
  );

  const slotMinutesForRank = availability.applyTaskDurationFilter
    ? availability.effectiveCapacityMinutes
    : null;

  const ordered = orderTasksStage1(slotAware, now, {
    slotMinutes: slotMinutesForRank,
  });

  const meta = stage1MetaForTasks(ordered, slotAware, now, slotMinutesForRank);

  // Today lists everything open: a task that's resting or too long for the
  // free slot stays in its place, since a list that drops due work is how a
  // deadline gets missed.
  const inventory = orderTasksStage1(filtered, now, {
    slotMinutes: slotMinutesForRank,
    restingLast: false,
  });
  const inventoryMeta = stage1MetaForTasks(
    inventory,
    filtered,
    now,
    slotMinutesForRank
  );
  const rests = new Map(
    filtered.flatMap((t) => {
      const rest = restOf(t, now);
      return rest ? [[t.id, rest] as const] : [];
    })
  );

  const danger = new Set(
    filtered.filter((t) => isDangerResolved(t, now)).map((t) => t.id)
  );
  const facts = await moduleTaskFacts(
    prisma,
    userId,
    ids.map((id) => ({ id, danger: danger.has(id) })),
    modules.isOn
  );

  return {
    rows,
    facts,
    minimal,
    filtered,
    slotAware,
    ordered,
    meta,
    inventory,
    inventoryMeta,
    rests,
    availability,
    slotMinutesForRank,
    timeZone,
  };
}

export function computeBriefingStripFromCore(
  core: Pick<
    FocusQueueCoreResult,
    "filtered" | "slotAware" | "availability" | "timeZone"
  >,
  now: Date = newDate()
) {
  const { filtered, slotAware, availability, timeZone } = core;
  const briefingBase = computeFocusBriefing(filtered, now, timeZone);
  return {
    ...briefingBase,
    pendingCount: slotAware.length,
    effectiveCapacityMinutes: availability.applyTaskDurationFilter
      ? availability.effectiveCapacityMinutes
      : null,
    slotNarrative: availability.slotNarrative ?? null,
  };
}
