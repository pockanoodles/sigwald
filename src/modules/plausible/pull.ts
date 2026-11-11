/**
 * Plausible's pull: visitors today, and visitors, pageviews and bounce rate
 * over the last 30 days, as readings. It makes no tasks.
 */
import { totals } from "@/lib/connectors/plausible/client";

import type { PullFn, PulledReading } from "@/modules/connect/pull";

export const pullPlausible: PullFn = async ({ http, secret, config }) => {
  const auth = { secret, config };
  const [today] = await totals(http, auth, ["visitors"], "day");
  const [visitors, pageviews, bounce] = await totals(
    http,
    auth,
    ["visitors", "pageviews", "bounce_rate"],
    "30d"
  );

  const readings: PulledReading[] = [];
  const add = (
    key: string,
    label: string,
    value: number | null,
    unit: string
  ) => {
    if (value !== null) readings.push({ key, label, value, unit });
  };
  add("visitors_today", "Visitors today", today, "count");
  add("visitors_30d", "Visitors, 30 days", visitors, "count");
  add("pageviews_30d", "Pageviews, 30 days", pageviews, "count");
  add(
    "bounce_30d",
    "Bounce rate, 30 days",
    bounce === null ? null : Math.round(bounce * 10) / 10,
    "percent"
  );
  return { items: [], complete: true, readings };
};
