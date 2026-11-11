/**
 * Asana's pull: tasks assigned to you in one workspace, asked with
 * `completed_since` set to the last good pull, so Asana answers every
 * incomplete task plus those completed since. A completed one that Sigwald
 * holds finishes its task; the rest are ignored.
 */
import { assignedTasks } from "@/lib/connectors/asana/client";
import type { AsanaTask } from "@/lib/connectors/asana/client";
import { ConnectorError } from "@/lib/connectors/errors";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

function toTask(task: AsanaTask): PulledTask {
  const projects = task.projects ?? [];
  const [first, ...rest] = projects;
  return {
    kind: "task",
    externalId: task.gid,
    title: task.name,
    state: "open",
    url: task.permalink_url ?? null,
    due: dueAt(task.due_at) ?? dueDay(task.due_on),
    group: first
      ? { key: `asana:project:${first.gid}`, label: first.name }
      : null,
    claims: rest.map((p) => ({
      key: `asana:project:${p.gid}`,
      label: `${p.name} (Asana)`,
    })),
    facts: [...fact("Projects", projects.map((p) => p.name).join(", "))],
    updatedAt: toDate(task.modified_at),
  };
}

export const pullAsana: PullFn = async (ctx) => {
  const { http, secret, config, settings, now } = ctx;
  const workspace = setting.text(settings, "workspace") || config.workspace;
  if (!workspace) {
    throw new ConnectorError(
      "config",
      "Asana has no workspace to read: set one in the module's settings"
    );
  }

  const { tasks, complete } = await assignedTasks(
    http,
    secret,
    workspace,
    ctx.lastSuccessAt ? ctx.lastSuccessAt.toISOString() : "now"
  );

  const held = new Map(ctx.open.map((o) => [o.externalId, o.title]));
  const items: PulledTask[] = [];
  for (const task of tasks) {
    if (!task.completed) {
      items.push(toTask(task));
      continue;
    }
    const title = held.get(task.gid);
    if (title === undefined) continue;
    items.push({
      kind: "task",
      externalId: task.gid,
      title,
      state: "done",
      doneAt: toDate(task.completed_at) ?? now,
    });
  }
  return { items, complete };
};
