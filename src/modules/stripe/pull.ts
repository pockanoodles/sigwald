/**
 * Stripe's pull: the balance, recurring revenue and 30-day charges as
 * readings, and disputes that need an answer as tasks. A dispute is done
 * once it's answered or settled; Stripe's evidence deadline is its due.
 */
import {
  type StripeBalanceTransaction,
  type StripeDispute,
  type StripeSubscription,
  balance,
  fromMinor,
  listAll,
} from "@/lib/connectors/stripe/client";

import {
  type PullFn,
  type PulledReading,
  type PulledTask,
  dueAt,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const NEEDS_ANSWER = new Set(["needs_response", "warning_needs_response"]);

/** A subscription item's price as a month's worth, in the smallest unit. */
export function monthly(
  item: StripeSubscription["items"]["data"][number]
): number {
  const { unit_amount, recurring } = item.price;
  if (unit_amount === null || !recurring) return 0;
  const count = recurring.interval_count || 1;
  const perMonth =
    { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[
      recurring.interval
    ] / count;
  return unit_amount * (item.quantity ?? 1) * perMonth;
}

function money(amount: number, currency: string): string {
  const value = fromMinor(amount, currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(value);
  } catch {
    return `${value} ${currency.toUpperCase()}`;
  }
}

export function disputeTask(d: StripeDispute): PulledTask {
  const amount = money(d.amount, d.currency);
  return {
    kind: "task",
    externalId: d.id,
    title: `Answer the ${amount} dispute`,
    state: NEEDS_ANSWER.has(d.status) ? "open" : "done",
    doneAt: null,
    url: `https://dashboard.stripe.com/${d.livemode ? "" : "test/"}disputes/${d.id}`,
    description: `Stripe takes evidence until the deadline; after it, the dispute is decided without you.`,
    due: dueAt(d.evidence_details?.due_by ?? null),
    // Money is on the line and the deadline is hard.
    impact: 0.9,
    facts: [
      ...fact("Amount", amount),
      ...fact("Reason", d.reason.replace(/_/g, " ")),
      ...fact("Status", d.status.replace(/_/g, " ")),
      ...fact("Charge", d.charge),
    ],
    updatedAt: toDate(d.created),
  };
}

export const pullStripe: PullFn = async ({ http, secret, settings, now }) => {
  const currency = (setting.text(settings, "currency") || "usd").toLowerCase();
  const readings: PulledReading[] = [];
  const items: PulledTask[] = [];
  let complete = true;

  const b = await balance(http, secret);
  const sum = (list: { amount: number; currency: string }[]) =>
    list
      .filter((x) => x.currency === currency)
      .reduce((total, x) => total + x.amount, 0);
  readings.push(
    {
      key: "balance",
      label: "Available",
      value: fromMinor(sum(b.available), currency),
      unit: currency,
    },
    {
      key: "pending",
      label: "Pending",
      value: fromMinor(sum(b.pending), currency),
      unit: currency,
    }
  );

  if (setting.on(settings, "mrr")) {
    const subs = await listAll<StripeSubscription>(
      http,
      secret,
      "/subscriptions",
      { status: "active" }
    );
    const total = subs.data
      .flatMap((s) => s.items.data)
      .filter((item) => item.price.currency === currency)
      .reduce((t, item) => t + monthly(item), 0);
    // A sum of the first thousand subscriptions isn't MRR: leave it out.
    if (subs.complete)
      readings.push({
        key: "mrr",
        label: "MRR",
        value: Math.round(fromMinor(total, currency) * 100) / 100,
        unit: currency,
      });
  }

  if (setting.on(settings, "volume")) {
    const since = Math.floor((now.getTime() - 30 * 86_400_000) / 1000);
    const charges = await listAll<StripeBalanceTransaction>(
      http,
      secret,
      "/balance_transactions",
      {
        type: "charge",
        "created[gte]": since,
      }
    );
    const total = charges.data
      .filter((c) => c.currency === currency)
      .reduce((t, c) => t + c.amount, 0);
    if (charges.complete)
      readings.push({
        key: "charges30",
        label: "Charges, 30 days",
        value: fromMinor(total, currency),
        unit: currency,
      });
  }

  if (setting.on(settings, "disputes")) {
    // Evidence windows run weeks, not months: older disputes are long decided.
    const disputes = await listAll<StripeDispute>(http, secret, "/disputes", {
      "created[gte]": Math.floor((now.getTime() - 120 * 86_400_000) / 1000),
    });
    if (!disputes.complete) complete = false;
    items.push(...disputes.data.map(disputeTask));
  }

  return { items, complete, readings };
};
