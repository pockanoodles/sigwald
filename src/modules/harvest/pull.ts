/**
 * Harvest's pull: your hours today and this week (weeks start Monday in
 * your zone) as readings, and open invoices past their due date as tasks to
 * chase. An invoice is done once it's paid or closed.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  type HarvestInvoice,
  invoice,
  openInvoices,
  timeEntries,
} from "@/lib/connectors/harvest/client";
import { mondayOf, round2 as round } from "@/lib/connectors/time-windows";
import { dayIn } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledReading,
  type PulledTask,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";

const MAX_DONE_CHECKS = 20;

function money(amount: number | undefined, currency: string | undefined) {
  if (typeof amount !== "number" || !currency) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function invoiceTask(inv: HarvestInvoice): PulledTask {
  const client = inv.client?.name ?? "no client";
  return {
    kind: "task",
    externalId: String(inv.id),
    title: `Chase invoice ${inv.number ?? inv.id} (${client})`,
    state: "open",
    description: "This invoice is past its due date and still unpaid.",
    due: dueDay(inv.due_date),
    impact: 0.7,
    group: inv.client
      ? {
          key: `harvest:client:${inv.client.id}`,
          label: `Harvest: ${inv.client.name}`,
        }
      : null,
    facts: [
      ...fact("Amount due", money(inv.due_amount ?? inv.amount, inv.currency)),
      ...fact("Due", inv.due_date),
    ],
  };
}

export const pullHarvest: PullFn = async ({
  http,
  secret,
  config,
  now,
  timeZone,
  open,
}) => {
  const readings: PulledReading[] = [];
  const items: PulledTask[] = [];
  let complete = true;
  const today = dayIn(now, timeZone);
  const monday = mondayOf(today);

  const entries = await timeEntries(http, secret, config, monday, today);
  // A partial sum isn't a total: leave the readings out.
  if (entries.complete) {
    const week = entries.data.filter(
      (e) => e.spent_date >= monday && e.spent_date <= today
    );
    const sum = (list: typeof week) =>
      round(list.reduce((t, e) => t + e.hours, 0));
    readings.push(
      {
        key: "hours_today",
        label: "Hours today",
        value: sum(week.filter((e) => e.spent_date === today)),
        unit: "hours",
      },
      {
        key: "hours_week",
        label: "Hours this week",
        value: sum(week),
        unit: "hours",
      },
      {
        key: "billable_week",
        label: "Billable this week",
        value: sum(week.filter((e) => e.billable)),
        unit: "hours",
      }
    );
  }

  try {
    const invoices = await openInvoices(http, secret, config);
    if (!invoices.complete) complete = false;
    const overdue = invoices.data.filter(
      (inv) => inv.due_date && inv.due_date.slice(0, 10) < today
    );
    items.push(...overdue.map(invoiceTask));

    // Held invoices that dropped off the list: ask whether they were paid.
    const listed = new Set(overdue.map((inv) => String(inv.id)));
    const gone = open.filter(
      (o) => o.kind === "task" && !listed.has(o.externalId)
    );
    if (gone.length > MAX_DONE_CHECKS) complete = false;
    for (const h of gone.slice(0, MAX_DONE_CHECKS)) {
      try {
        const inv = await invoice(http, secret, config, h.externalId);
        // Only a paid invoice was chased to its end. One written off
        // (closed), back in draft, voided, or open but no longer overdue has
        // nothing left to chase: gone, said of it so the next pull checks
        // the next.
        items.push(
          inv.state === "paid"
            ? {
                kind: "task",
                externalId: h.externalId,
                title: h.title,
                state: "done",
                doneAt: toDate(inv.paid_at) ?? now,
              }
            : {
                kind: "task",
                externalId: h.externalId,
                title: h.title,
                state: "gone",
              }
        );
      } catch (error) {
        if (!isConnectorError(error)) throw error;
        if (error.kind === "not_found") {
          items.push({
            kind: "task",
            externalId: h.externalId,
            title: h.title,
            state: "gone",
          });
        } else {
          complete = false;
        }
      }
    }
  } catch (error) {
    // Invoices need an Administrator or Manager: hours still count without them.
    if (!isConnectorError(error) || error.kind !== "forbidden") throw error;
    complete = false;
  }

  return { items, complete, readings };
};
