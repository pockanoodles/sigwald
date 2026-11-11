/**
 * YNAB's pull: Ready to Assign and age of money as readings, one task to
 * approve waiting transactions, and a task to cover each category that is
 * overspent this month. Each is done once nothing is left to do.
 *
 * Amounts are milliunits (1000 to a unit). "This month" is the calendar
 * month in the person's zone. Held tasks that are no longer needed come
 * back done with their held title.
 */
import { currencyOf, month, unapproved } from "@/lib/connectors/ynab/client";
import { dayIn } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledReading,
  type PulledTask,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

export const pullYnab: PullFn = async ({
  http,
  secret,
  settings,
  now,
  timeZone,
  open,
}) => {
  const budget = setting.text(settings, "budget").trim() || "last-used";
  const firstDay = `${dayIn(now, timeZone).slice(0, 7)}-01`;
  const group = {
    key: `ynab:budget:${budget.toLowerCase()}`,
    label: "YNAB budget",
  };
  const readings: PulledReading[] = [];
  const items: PulledTask[] = [];

  const currency = await currencyOf(http, secret, budget);
  const thisMonth = await month(http, secret, budget, firstDay);
  const waiting = await unapproved(http, secret, budget);

  // Without the budget's currency, Ready to Assign has no unit: leave it out.
  if (currency)
    readings.push({
      key: "ready_to_assign",
      label: "Ready to Assign",
      value: Math.round(thisMonth.to_be_budgeted) / 1000,
      unit: currency,
    });
  if (typeof thisMonth.age_of_money === "number")
    readings.push({
      key: "age_of_money",
      label: "Age of money, days",
      value: thisMonth.age_of_money,
      unit: "count",
    });

  const heldTitle = new Map(open.map((o) => [o.externalId, o.title]));
  const finish = (externalId: string) => {
    const title = heldTitle.get(externalId);
    if (title !== undefined)
      items.push({
        kind: "task",
        externalId,
        title,
        state: "done",
        doneAt: now,
      });
  };

  const approveId = `approve:${budget.toLowerCase()}`;
  const count = waiting.filter((t) => !t.approved && !t.deleted).length;
  if (count > 0)
    items.push({
      kind: "task",
      externalId: approveId,
      title: `Approve ${count} ${count === 1 ? "transaction" : "transactions"}`,
      state: "open",
      url: "https://app.ynab.com",
      description:
        "Transactions that came in from your accounts and wait for you to check them.",
      impact: 0.4,
      group,
      facts: [{ label: "Waiting", value: String(count) }],
    });
  else finish(approveId);

  const overspent = new Set<string>();
  for (const c of thisMonth.categories) {
    if (c.deleted || c.hidden || c.balance >= 0) continue;
    const externalId = `cover:${c.id}`;
    overspent.add(externalId);
    items.push({
      kind: "task",
      externalId,
      title: `Cover ${c.name}`,
      state: "open",
      url: "https://app.ynab.com",
      description: "This category is overspent this month. Move money into it.",
      impact: 0.7,
      group,
      facts: [{ label: "Short by", value: (-c.balance / 1000).toFixed(2) }],
    });
  }
  for (const o of open)
    if (o.externalId.startsWith("cover:") && !overspent.has(o.externalId))
      finish(o.externalId);

  return { items, complete: true, readings };
};
