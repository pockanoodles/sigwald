/**
 * Lemon Squeezy's pull: revenue and sales across your stores, all time and
 * over the last 30 days. Lemon Squeezy gives revenue in cents of US dollars
 * for every store, whatever the store's own currency, so stores add up. A
 * list that was cut off isn't a total, so then no reading is made.
 */
import { stores } from "@/lib/connectors/lemonsqueezy/client";

import type { PullFn } from "@/modules/connect/pull";

export const pullLemonSqueezy: PullFn = async ({ http, secret }) => {
  const list = await stores(http, secret);
  if (!list.complete) return { items: [], complete: true };

  const sum = (pick: (s: (typeof list.data)[number]["attributes"]) => number) =>
    list.data.reduce((t, s) => t + (Number(pick(s.attributes)) || 0), 0);
  const dollars = (cents: number) => Math.round(cents) / 100;

  return {
    items: [],
    complete: true,
    readings: [
      {
        key: "revenue_30d",
        label: "Revenue, 30 days",
        value: dollars(sum((s) => s.thirty_day_revenue)),
        unit: "usd",
      },
      {
        key: "revenue_total",
        label: "Revenue, all time",
        value: dollars(sum((s) => s.total_revenue)),
        unit: "usd",
      },
      {
        key: "sales_30d",
        label: "Sales, 30 days",
        value: sum((s) => s.thirty_day_sales),
        unit: "count",
      },
      {
        key: "sales_total",
        label: "Sales, all time",
        value: sum((s) => s.total_sales),
        unit: "count",
      },
    ],
  };
};
