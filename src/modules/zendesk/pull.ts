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

export const pullZendesk: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const { tickets, complete } = await assignedOpen(http, secret, config);
  const open = tickets.map((t) => toTask(t, config));
  const seen = new Set(open.map((t) => t.externalId));
  const missing = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !seen.has(o.externalId))
      .slice(0, 100)
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  for (const t of await ticketsById(http, secret, config, [
    ...missing.keys(),
  ])) {
    const title = missing.get(String(t.id));
    if (title === undefined) continue;
    if (t.status !== "solved" && t.status !== "closed") continue;
    finished.push({
      kind: "task",
      externalId: String(t.id),
      title,
      state: "done",
      doneAt: toDate(t.updated_at) ?? now,
    });
  }
  return { items: [...open, ...finished], complete };
};
