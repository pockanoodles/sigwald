/**
 * Where a connector module's pulls land (server only): the mirror
 * (`ModuleItem`), the tasks and calendar events projected from it, and the
 * day's readings. One pass per module at a time, under a lock, so a tick of
 * the sync loop and a "Pull now" can't both make the same task.
 */
import type { Prisma } from "@prisma/client";

import { dayIn } from "@/lib/date-utils";
import { type DbTransaction, prisma } from "@/lib/prisma";

import { moduleById } from "@/modules";
import { tasksChanged } from "@/modules/hooks";
import type { ModuleId } from "@/modules/types";

import {
  type HeldItem,
  type ItemWrite,
  type PlanCounts,
  groupsOf,
  planPull,
} from "./plan";
import type { PullResult, PulledReading } from "./pull";

/** A finished or gone item is forgotten this long after it was last seen (its task stays). */
const FORGET_AFTER_MS = 120 * 24 * 60 * 60 * 1000;

/** The colour a module's calendar starts with; people can change it like any calendar's. */
const FEED_COLOR = "#8B7E66FF";

export interface ApplyOptions {
  now: Date;
  timeZone: string;
  maxOpen: number;
}

export interface Applied {
  counts: PlanCounts;
  readings: number;
}

/** The task source a connector module's tasks carry: the first it declares (none for one that makes no tasks). */
function sourceOf(moduleId: ModuleId): string | null {
  return moduleById(moduleId).sources[0] ?? null;
}

async function loadHeld(
  tx: DbTransaction,
  userId: string,
  moduleId: ModuleId
): Promise<HeldItem[]> {
  return tx.moduleItem.findMany({
    where: { userId, moduleId },
    select: {
      id: true,
      externalId: true,
      kind: true,
      state: true,
      doneAt: true,
      title: true,
      url: true,
      facts: true,
      group: true,
      upstreamUpdatedAt: true,
      lastSeenAt: true,
      projectedAt: true,
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          dueDate: true,
          impact: true,
          duration: true,
          externalUrl: true,
          externalListId: true,
          claims: true,
          status: true,
          completedAt: true,
          closedAt: true,
        },
      },
      event: {
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          start: true,
          end: true,
          allDay: true,
          transparency: true,
        },
      },
    },
  });
}

/** The module's own LOCAL calendar, made if it has none (or it was deleted). */
async function ensureFeed(
  tx: DbTransaction,
  userId: string,
  moduleId: ModuleId
): Promise<string> {
  const sync = await tx.moduleSync.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
    select: { feedId: true },
  });
  if (sync?.feedId) {
    const feed = await tx.calendarFeed.findFirst({
      where: { id: sync.feedId, userId },
      select: { id: true },
    });
    if (feed) return feed.id;
  }
  const feed = await tx.calendarFeed.create({
    data: {
      userId,
      type: "LOCAL",
      url: `module:${moduleId}`,
      name: moduleById(moduleId).name,
      color: FEED_COLOR,
    },
    select: { id: true },
  });
  await tx.moduleSync.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    create: { userId, moduleId, feedId: feed.id },
    update: { feedId: feed.id },
  });
  return feed.id;
}

async function writeOne(
  tx: DbTransaction,
  userId: string,
  moduleId: ModuleId,
  write: ItemWrite,
  context: {
    now: Date;
    source: string | null;
    category: string;
    feed: () => Promise<string>;
  }
): Promise<string | null> {
  const { now } = context;
  let itemId = write.heldId;
  const item = write.item as
    | (Prisma.ModuleItemUncheckedUpdateInput & { facts?: unknown })
    | null;
  if (!itemId) {
    const made = await tx.moduleItem.create({
      data: {
        ...(item as Prisma.ModuleItemUncheckedCreateInput),
        facts: (item?.facts ?? []) as Prisma.InputJsonValue,
        userId,
        moduleId,
        externalId: write.externalId,
      },
      select: { id: true },
    });
    itemId = made.id;
  } else if (item) {
    await tx.moduleItem.update({
      where: { id: itemId },
      data: { ...item, facts: item.facts as Prisma.InputJsonValue | undefined },
    });
  }

  let changedTask: string | null = null;
  if (write.task?.kind === "create") {
    if (!context.source)
      throw new Error(`${moduleId} makes tasks but declares no task source`);
    const task = await tx.task.create({
      data: {
        ...write.task.fields,
        userId,
        status: "todo",
        source: context.source,
        externalTaskId: write.externalId,
        category: context.category,
        lastSyncedAt: now,
        // Task sync to Google and Outlook never takes these: they live in their service.
        skipSync: true,
      },
      select: { id: true },
    });
    await tx.moduleItem.update({
      where: { id: itemId },
      data: { taskId: task.id, projectedAt: now },
    });
    changedTask = task.id;
  } else if (write.task?.kind === "update") {
    await tx.task.update({
      where: { id: write.task.taskId },
      data: { ...write.task.change, lastSyncedAt: now },
    });
    changedTask = write.task.taskId;
  }

  if (write.event?.kind === "put") {
    const data = { ...write.event.fields, status: "confirmed" };
    let placed = false;
    if (write.event.eventId) {
      const moved = await tx.calendarEvent.updateMany({
        where: { id: write.event.eventId },
        data,
      });
      placed = moved.count > 0;
    }
    if (!placed) {
      const feedId = await context.feed();
      const event = await tx.calendarEvent.create({
        data: {
          ...data,
          feedId,
          externalEventId: `${moduleId}:${write.externalId}`,
        },
        select: { id: true },
      });
      await tx.moduleItem.update({
        where: { id: itemId },
        data: { eventId: event.id },
      });
    }
  } else if (write.event?.kind === "remove") {
    // The item's eventId clears itself (ON DELETE SET NULL).
    await tx.calendarEvent.deleteMany({ where: { id: write.event.eventId } });
  }

  return changedTask;
}

async function writeReadings(
  tx: DbTransaction,
  userId: string,
  moduleId: ModuleId,
  readings: readonly PulledReading[],
  now: Date,
  timeZone: string
): Promise<void> {
  const day = new Date(`${dayIn(now, timeZone)}T00:00:00.000Z`);
  for (const r of readings) {
    await tx.moduleReading.upsert({
      where: { userId_moduleId_key_day: { userId, moduleId, key: r.key, day } },
      create: {
        userId,
        moduleId,
        key: r.key,
        label: r.label,
        unit: r.unit,
        value: r.value,
        day,
        at: now,
      },
      update: { label: r.label, unit: r.unit, value: r.value, at: now },
    });
  }
}

/**
 * Adds the claim groups the answer named (a repo, an Inbox list) to the ones
 * the module has named before, for the goal form. Whether a pull or the
 * Inbox wrote it, it lands here.
 */
async function writeGroups(
  tx: DbTransaction,
  userId: string,
  moduleId: ModuleId,
  named: Record<string, string>
): Promise<void> {
  if (Object.keys(named).length === 0) return;
  const sync = await tx.moduleSync.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
    select: { groups: true },
  });
  const had =
    sync?.groups &&
    typeof sync.groups === "object" &&
    !Array.isArray(sync.groups)
      ? (sync.groups as Record<string, string>)
      : {};
  const groups = { ...had, ...named };
  if (JSON.stringify(groups) === JSON.stringify(had)) return;
  await tx.moduleSync.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    create: { userId, moduleId, groups },
    update: { groups },
  });
}

/**
 * Writes what a pull saw: plans it against what's held (src/modules/connect/plan.ts)
 * and writes the plan, then tells the goal rules which tasks changed.
 * `result` must already be cleaned (`cleanResult`).
 */
export async function applyPull(
  userId: string,
  moduleId: ModuleId,
  result: PullResult & { readings: readonly PulledReading[] },
  options: ApplyOptions
): Promise<Applied> {
  const manifest = moduleById(moduleId);
  const source = sourceOf(moduleId);
  const category = manifest.connect?.taskCategory ?? "WORK";
  const { now, timeZone, maxOpen } = options;

  const { counts, changed } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connect:${userId}:${moduleId}`}))`;
      const held = await loadHeld(tx, userId, moduleId);
      const plan = planPull({
        held,
        result,
        now,
        timeZone,
        maxOpen,
        removePastEvents: manifest.connect?.forgetPastEvents === true,
      });

      let feedId: string | null = null;
      const feed = async () =>
        (feedId ??= await ensureFeed(tx, userId, moduleId));
      const changed: string[] = [];
      for (const write of plan.writes) {
        const taskId = await writeOne(tx, userId, moduleId, write, {
          now,
          source,
          category,
          feed,
        });
        if (taskId) changed.push(taskId);
      }
      await writeReadings(tx, userId, moduleId, result.readings, now, timeZone);
      await writeGroups(tx, userId, moduleId, groupsOf(result));
      await tx.moduleItem.deleteMany({
        where: {
          userId,
          moduleId,
          state: { in: ["done", "gone"] },
          lastSeenAt: { lt: new Date(now.getTime() - FORGET_AFTER_MS) },
        },
      });
      return { counts: plan.counts, changed };
    },
    { timeout: 60_000, maxWait: 20_000 }
  );

  if (changed.length > 0) await tasksChanged(prisma, userId, changed);
  return { counts, readings: result.readings.length };
}
