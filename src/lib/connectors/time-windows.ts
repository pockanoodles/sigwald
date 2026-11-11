/**
 * Day and week windows for the modules that total hours (Harvest, Toggl,
 * Clockify). Weeks start on Monday in the person's zone.
 */
import { dayIn, shiftDay, startOfDayIn } from "@/lib/date-utils";

/** The Monday on or before a day ("2026-11-11" is a Wednesday). */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

export interface Windows {
  today: { from: Date; to: Date };
  week: { from: Date; to: Date };
}

/** Today and this week as instants in the person's zone, each ending at the start of the next day. */
export function windowsFor(now: Date, timeZone: string): Windows {
  const day = dayIn(now, timeZone);
  const to = startOfDayIn(shiftDay(day, 1), timeZone);
  return {
    today: { from: startOfDayIn(day, timeZone), to },
    week: { from: startOfDayIn(mondayOf(day), timeZone), to },
  };
}

/**
 * Hours of the span from `start` to `end` that fall inside a window, so an
 * entry that crosses midnight counts in each day it touches.
 */
export function hoursWithin(
  start: Date,
  end: Date,
  window: { from: Date; to: Date }
): number {
  const from = Math.max(start.getTime(), window.from.getTime());
  const to = Math.min(end.getTime(), window.to.getTime());
  return to > from ? (to - from) / 3_600_000 : 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
