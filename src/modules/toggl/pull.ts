/**
 * Toggl Track's pull: the hours you tracked today and this week (weeks
 * start Monday in your zone). A running timer, which Toggl gives a negative
 * duration, counts from its start up to now. An entry that crosses midnight
 * counts in each day it touches.
 */
import { hoursWithin, round2, windowsFor } from "@/lib/connectors/time-windows";
import { ENTRY_LIMIT, timeEntries } from "@/lib/connectors/toggl/client";

import { type PullFn, toDate } from "@/modules/connect/pull";

export const pullToggl: PullFn = async ({ http, secret, now, timeZone }) => {
  const { today, week } = windowsFor(now, timeZone);
  // Start a day early so an entry begun before Monday that runs past it counts.
  const entries = await timeEntries(
    http,
    secret,
    new Date(week.from.getTime() - 86_400_000),
    week.to
  );
  // A cut-off list isn't a total: leave the readings out.
  if (entries.length >= ENTRY_LIMIT) return { items: [], complete: true };

  let todayHours = 0;
  let weekHours = 0;
  for (const e of entries) {
    const start = toDate(e.start);
    if (!start) continue;
    const end =
      e.duration < 0
        ? now
        : (toDate(e.stop) ?? new Date(start.getTime() + e.duration * 1000));
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
