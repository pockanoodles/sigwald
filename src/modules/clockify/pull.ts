/**
 * Clockify's pull: the hours you tracked today and this week (weeks start
 * Monday in your zone). A running entry has no end, so it counts from its
 * start up to now. An entry that crosses midnight counts in each day it
 * touches.
 */
import { timeEntries } from "@/lib/connectors/clockify/client";
import { hoursWithin, round2, windowsFor } from "@/lib/connectors/time-windows";

import { type PullFn, toDate } from "@/modules/connect/pull";

export const pullClockify: PullFn = async ({
  http,
  secret,
  config,
  now,
  timeZone,
}) => {
  const { today, week } = windowsFor(now, timeZone);
  // Start a day early so an entry begun before Monday that runs past it counts.
  const entries = await timeEntries(
    http,
    secret,
    config,
    new Date(week.from.getTime() - 86_400_000),
    week.to
  );
  // A cut-off list isn't a total: leave the readings out.
  if (!entries.complete) return { items: [], complete: true };

  let todayHours = 0;
  let weekHours = 0;
  for (const e of entries.data) {
    const start = toDate(e.timeInterval?.start);
    if (!start) continue;
    const end = toDate(e.timeInterval.end) ?? now;
    todayHours += hoursWithin(start, end, today);
    weekHours += hoursWithin(start, end, week);
  }
  return {
    items: [],
    complete: true,
    readings: [
      {
        key: "hours_today",
        label: "Hours today",
        value: round2(todayHours),
        unit: "hours",
      },
      {
        key: "hours_week",
        label: "Hours this week",
        value: round2(weekHours),
        unit: "hours",
      },
    ],
  };
};
