/**
 * Zendesk's pull: the tickets assigned to you that aren't solved, plus the
 * held ones that are solved or closed now (looked up by id), so solving a
 * ticket in Zendesk finishes its task. A ticket that was reassigned just
 * stops being listed and closes undone. No ticket text is kept: only its
 * number, subject and fields.
 */
import {
  type ZendeskTicket,
  assignedOpen,
  ticketUrl,
  ticketsById,
} from "@/lib/connectors/zendesk/client";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  fact,
  toDate,
} from "@/modules/connect/pull";

/** Zendesk's ticket priority as Sigwald's weight. */
export function impactOfPriority(priority: string | null | undefined) {
  return (
    (
      { urgent: 0.9, high: 0.7, normal: 0.4, low: 0.15 } as Record<
        string,
        number
      >
    )[priority ?? ""] ?? null
  );
}

export function toTask(
  t: ZendeskTicket,
  config: Readonly<Record<string, string>>
): PulledTask {
  return {
    kind: "task",
    externalId: String(t.id),
    title: `#${t.id} ${t.subject?.trim() || "(no subject)"}`,
    state: "open",
    url: ticketUrl(config, t.id),
    due: dueAt(t.due_at),
    impact: impactOfPriority(t.priority),
    group: { key: "zendesk:tickets", label: "Zendesk tickets" },
    facts: [
      ...fact("Ticket", `#${t.id}`),
      ...fact("Status", t.status),
      ...fact("Type", t.type),
      ...fact("Priority", t.priority),
    ],
    updatedAt: toDate(t.updated_at),
  };
}

/** Held items looked up per pull, at most. */
const MAX_CHECKS = 100;

export const pullZendesk: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const { tickets, complete } = await assignedOpen(http, secret, config);
  const open = tickets.map((t) => toTask(t, config));
  const seen = new Set(open.map((t) => t.externalId));
  // Held items that dropped off the open list, a batch at a time: each one
  // checked is said to be done or gone, so it leaves the open set and the
  // next pull checks the next batch.
  const missingAll = ctx.open.filter(
    (o) => o.kind === "task" && !seen.has(o.externalId)
  );
  const missing = new Map(
    missingAll.slice(0, MAX_CHECKS).map((o) => [o.externalId, o.title])
  );
  const listComplete = complete;
  const whole = listComplete && missingAll.length <= MAX_CHECKS;
  const finished: PulledTask[] = [];
  for (const t of await ticketsById(http, secret, config, [
    ...missing.keys(),
  ])) {
    const id = String(t.id);
    const title = missing.get(id);
    if (title === undefined) continue;
    // Solved by whoever it was reassigned to isn't yours to count.
    if (t.assignee_id != null && String(t.assignee_id) !== config.userId)
      continue;
    if (!(t.status === "solved" || t.status === "closed")) continue;
    missing.delete(id);
    finished.push({
      kind: "task",
      externalId: id,
      title,
      state: "done",
      doneAt: toDate(t.updated_at) ?? now,
    });
  }
  // The rest of the batch isn't done and, by a complete list, isn't yours.
  if (listComplete) {
    for (const [externalId, title] of missing) {
      finished.push({ kind: "task", externalId, title, state: "gone" });
    }
  }
  return { items: [...open, ...finished], complete: whole };
};
