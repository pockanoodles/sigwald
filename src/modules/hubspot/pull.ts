/**
 * HubSpot's pull: your open CRM tasks, plus the held ones that have been
 * completed since (read by id, in one search), so finishing a task in
 * HubSpot finishes it here. One that simply stops being listed closes undone.
 */
import {
  type HubspotTask,
  completedAmong,
  openTasks,
} from "@/lib/connectors/hubspot/client";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  fact,
  plainText,
  toDate,
} from "@/modules/connect/pull";

const TYPES: Record<string, string> = {
  CALL: "Call",
  EMAIL: "Email",
  TODO: "To do",
};
const PREFIXED = new Set(["CALL", "EMAIL"]);

/** HubSpot's task priority as Sigwald's weight. */
export function impactOfPriority(priority: string | null | undefined) {
  return (
    ({ HIGH: 0.7, MEDIUM: 0.4, LOW: 0.15 } as Record<string, number>)[
      priority ?? ""
    ] ?? null
  );
}

/** HubSpot gives a due as ms epoch text or an ISO time. */
function due(value: string | null | undefined) {
  if (!value) return null;
  return dueAt(/^\d+$/.test(value) ? Number(value) : value);
}

export function toTask(task: HubspotTask, ownerId: string): PulledTask {
  const p = task.properties;
  const type = p.hs_task_type ?? "";
  const subject = p.hs_task_subject?.trim() || "Untitled task";
  return {
    kind: "task",
    externalId: task.id,
    title: PREFIXED.has(type) ? `${TYPES[type]}: ${subject}` : subject,
    state: "open",
    description: plainText(p.hs_task_body),
    due: due(p.hs_timestamp),
    impact: impactOfPriority(p.hs_task_priority),
    group: { key: `hubspot:owner:${ownerId}`, label: "HubSpot tasks" },
    facts: [
      ...fact("Type", TYPES[type]),
      ...fact("Status", p.hs_task_status?.replace(/_/g, " ").toLowerCase()),
      ...fact("Priority", p.hs_task_priority?.toLowerCase()),
    ],
    updatedAt: toDate(p.hs_lastmodifieddate),
  };
}

export const pullHubspot: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const ownerId = config.ownerId;
  if (!ownerId) return { items: [], complete: false };

  const { tasks, complete } = await openTasks(http, secret, ownerId);
  const open = tasks.map((t) => toTask(t, ownerId));
  const seen = new Set(open.map((t) => t.externalId));
  const missing = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !seen.has(o.externalId))
      .slice(0, 100)
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  for (const task of await completedAmong(http, secret, [...missing.keys()])) {
    const title = missing.get(task.id);
    if (title === undefined) continue;
    finished.push({
      kind: "task",
      externalId: task.id,
      title,
      state: "done",
      doneAt:
        toDate(task.properties.hs_task_completion_date) ??
        toDate(task.properties.hs_lastmodifieddate) ??
        now,
    });
  }
  return { items: [...open, ...finished], complete };
};
