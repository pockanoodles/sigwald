/**
 * Dates on search hits, worded where the person is: the server runs in its
 * own zone, so every date here is read in theirs (`SearchQuery.timeZone`).
 */
import { dayIn, formatInTimeZone, shiftDay } from "@/lib/date-utils";

import type { SearchQuery } from "./types";

/** "Today", "Tomorrow", "Yesterday", a weekday within the week ahead, else "Dec 3" (with the year when it isn't this one). */
export function wordDay(
  day: string,
  q: Pick<SearchQuery, "now" | "timeZone">
): string {
  const today = dayIn(q.now, q.timeZone);
  if (day === today) return "Today";
  if (day === shiftDay(today, 1)) return "Tomorrow";
  if (day === shiftDay(today, -1)) return "Yesterday";
  // Noon UTC names the same calendar day in every zone.
  const noon = new Date(`${day}T12:00:00Z`);
  if (day > today && day <= shiftDay(today, 6)) {
    return formatInTimeZone(noon, "UTC", "EEEE");
  }
  return formatInTimeZone(
    noon,
    "UTC",
    day.slice(0, 4) === today.slice(0, 4) ? "MMM d" : "MMM d, yyyy"
  );
}

/** "Due today", "Due Saturday", "Due Oct 27": a deadline that's past or settled. */
export function wordDue(
  day: string,
  q: Pick<SearchQuery, "now" | "timeZone">
): string {
  const word = wordDay(day, q);
  return `Due ${RELATIVE.has(word) ? word.toLowerCase() : word}`;
}

const RELATIVE = new Set(["Today", "Tomorrow", "Yesterday"]);

/** A moment: its day, then its time in the person's clock format. */
export function wordMoment(at: Date, q: SearchQuery): string {
  const time = formatInTimeZone(
    at,
    q.timeZone,
    q.timeFormat === "24h" ? "HH:mm" : "h:mm a"
  );
  return `${wordDay(dayIn(at, q.timeZone), q)} ${time}`;
}
