/**
 * ClickUp's pull: the open tasks assigned to you across the workspace, and,
 * when Sigwald holds open tasks that no longer show up, the closed ones
 * updated since the last pull, so a task you closed finishes instead of
 * just vanishing.
 */
import {
  type ClickupTask,
  assignedTasks,
} from "@/lib/connectors/clickup/client";
import { ConnectorError } from "@/lib/connectors/errors";
import { dayIn } from "@/lib/date-utils";

import {
  type Due,
  type PullFn,
  type PulledTask,
  dueAt,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const FIRST_LOOKBACK_DAYS = 7;

const IMPACT: Record<string, number> = {
  urgent: 0.9,
  high: 0.7,
  normal: 0.4,
  low: 0.15,
};

function impactOf(task: ClickupTask): number | null {
  const name = task.priority?.priority?.toLowerCase();
  return name && name in IMPACT ? IMPACT[name] : null;
}

function ms(value: string | null | undefined): Date | null {
  return value ? toDate(Number(value)) : null;
}

function dueOf(task: ClickupTask, timeZone: string): Due | null {
  const at = ms(task.due_date);
  if (!at) return null;
  // A due date set without a time is stored at a fixed hour of its day.
  return task.due_date_time === false
    ? dueDay(dayIn(at, timeZone))
    : dueAt(at.getTime());
}

function toTask(task: ClickupTask, timeZone: string): PulledTask {
  const list = task.list;
  return {
    kind: "task",
    externalId: task.id,
    title: task.name,
    state: "open",
    url: task.url ?? null,
    description:
      (task.text_content ?? task.description ?? "").slice(0, 4000) || null,
    due: dueOf(task, timeZone),
    impact: impactOf(task),
    group: list
      ? {
          key: `clickup:list:${list.id}`.toLowerCase(),
          label: list.name ?? "ClickUp list",
        }
      : null,
    facts: [
      ...fact("List", list?.name),
      ...fact("Folder", task.folder?.name),
      ...fact("Status", task.status?.status),
      ...fact("Priority", task.priority?.priority),
      ...fact("Tags", task.tags?.map((t) => t.name).join(", ")),
    ],
    updatedAt: ms(task.date_updated),
  };
}

export const pullClickup: PullFn = async (ctx) => {
  const { http, secret, config, settings, now, timeZone } = ctx;
  const teamId = setting.text(settings, "team") || config.teamId;
  const userId = config.userId;
  if (!teamId || !userId) {
    throw new ConnectorError(
      "config",
      "Reconnect ClickUp to find your workspace"
    );
  }

  const found = await assignedTasks(http, secret, teamId, userId);
  let complete = found.complete;
  const open = new Map(found.tasks.map((t) => [t.id, toTask(t, timeZone)]));

  const missing = new Map(
    ctx.open
      .filter((o) => !open.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (missing.size > 0) {
    const from =
      ctx.lastSuccessAt ??
      new Date(now.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
    // An hour before the last pull, so an update at its edge isn't missed.
    const closed = await assignedTasks(http, secret, teamId, userId, {
      closedSince: from.getTime() - 3_600_000,
      pages: 2,
    });
    if (!closed.complete) complete = false;
    for (const task of closed.tasks) {
      const title = missing.get(task.id);
      if (title === undefined) continue;
      const doneAt = ms(task.date_closed ?? task.date_done);
      if (!doneAt) continue;
      missing.delete(task.id);
      finished.push({
        ...toTask(task, timeZone),
        title,
        state: "done",
        doneAt,
      });
    }
  }
  return { items: [...open.values(), ...finished], complete };
};
