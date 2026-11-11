/**
 * Todoist's pull: the active tasks that are yours or unassigned (the API
 * has no assignee filter, so it drops the ones assigned to someone else),
 * and, when Sigwald holds open tasks that no longer show up, the tasks
 * completed since the last pull, so a task you checked off finishes.
 *
 * A recurring task's due is its next occurrence, which is what Todoist
 * reports; nothing here treats it specially.
 */
import { fromZonedTime } from "date-fns-tz";

import {
  type TodoistTask,
  activeTasks,
  completedTasks,
  projectNames,
} from "@/lib/connectors/todoist/client";

import {
  type Due,
  type PullFn,
  type PulledTask,
  dueAt,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";

/** The completed-tasks read reaches back 3 months at most. */
const MAX_LOOKBACK_MS = 85 * 86_400_000;
const FIRST_LOOKBACK_MS = 7 * 86_400_000;

const IMPACT: Record<number, number> = { 4: 0.9, 3: 0.7, 2: 0.4 };

function dueOf(task: TodoistTask, timeZone: string): Due | null {
  // A deadline is the hard date, so it wins over a due date.
  if (task.deadline?.date) return dueDay(task.deadline.date);
  const date = task.due?.date;
  if (!date) return null;
  if (!date.includes("T")) return dueDay(date);
  // With a Z it's a fixed-zone moment; without, a floating time on the person's clock.
  if (/(Z|[+-]\d{2}:\d{2})$/.test(date)) return dueAt(date);
  const at = fromZonedTime(date.slice(0, 19), timeZone);
  return Number.isNaN(at.getTime()) ? null : { at };
}

function toTask(
  task: TodoistTask,
  projects: Map<string, string>,
  timeZone: string
): PulledTask {
  const project = projects.get(task.project_id);
  return {
    kind: "task",
    externalId: task.id,
    title: task.content,
    state: "open",
    url: `https://app.todoist.com/app/task/${task.id}`,
    description: task.description ? task.description.slice(0, 4000) : null,
    due: dueOf(task, timeZone),
    impact: IMPACT[task.priority] ?? null,
    group: {
      key: `todoist:project:${task.project_id}`.toLowerCase(),
      label: project ?? "Todoist project",
    },
    facts: [
      ...fact("Project", project),
      ...fact("Labels", task.labels?.join(", ")),
      ...fact("Deadline", task.deadline?.date),
    ],
    updatedAt: toDate(task.updated_at),
  };
}

export const pullTodoist: PullFn = async (ctx) => {
  const { http, secret, config, now, timeZone } = ctx;
  const [found, projects] = await Promise.all([
    activeTasks(http, secret),
    projectNames(http, secret),
  ]);
  let complete = found.complete;
  const mine = found.rows.filter(
    (t) => !t.responsible_uid || t.responsible_uid === config.userId
  );
  const open = new Map(mine.map((t) => [t.id, toTask(t, projects, timeZone)]));

  const missing = new Map(
    ctx.open
      .filter((o) => !open.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (missing.size > 0) {
    const from = ctx.lastSuccessAt
      ? ctx.lastSuccessAt.getTime() - 3_600_000
      : now.getTime() - FIRST_LOOKBACK_MS;
    const since = new Date(Math.max(from, now.getTime() - MAX_LOOKBACK_MS));
    const done = await completedTasks(http, secret, since, now);
    if (!done.complete) complete = false;
    for (const task of done.rows) {
      const title = missing.get(task.id);
      if (title === undefined) continue;
      missing.delete(task.id);
      finished.push({
        ...toTask(task, projects, timeZone),
        title,
        state: "done",
        doneAt: toDate(task.completed_at) ?? now,
      });
    }
  }
  return { items: [...open.values(), ...finished], complete };
};
