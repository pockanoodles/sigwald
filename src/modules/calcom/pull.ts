/**
 * Cal.com's pull: your upcoming bookings (the next 30 days, and any that
 * started in the last day) as busy events. A held booking that is now
 * listed as cancelled comes back done, which takes it off the calendar. One
 * that simply stops being listed is treated as gone.
 */
import { type CalcomBooking, bookingsIn } from "@/lib/connectors/calcom/client";

import {
  type PullFn,
  type PulledEvent,
  fact,
  toDate,
} from "@/modules/connect/pull";

const DAY = 86_400_000;

function toEvent(b: CalcomBooking): PulledEvent | null {
  const start = toDate(b.start);
  const end = toDate(b.end);
  if (!start || !end) return null;
  const names = (b.attendees ?? [])
    .map((a) => a.name?.trim() ?? "")
    .filter((n) => n.length > 0);
  const place = b.location?.trim() ?? "";
  const link = (
    b.meetingUrl ?? (/^https?:\/\//.test(place) ? place : "")
  )?.trim();
  return {
    kind: "event",
    externalId: b.uid,
    title: b.title?.trim() || "Cal.com booking",
    state: "open",
    start,
    end,
    busy: true,
    location: place && !/^https?:\/\//.test(place) ? place : null,
    url: link || null,
    description: names.length > 0 ? `With ${names.join(", ")}` : null,
    facts: [...fact("Booked by", names.join(", "))],
    updatedAt: toDate(b.updatedAt),
  };
}

export const pullCalcom: PullFn = async (ctx) => {
  const { http, secret, now } = ctx;
  const from = new Date(now.getTime() - DAY);
  const to = new Date(now.getTime() + 30 * DAY);

  const upcoming = await bookingsIn(http, secret, "upcoming", from, to);
  let complete = upcoming.complete;
  const items: PulledEvent[] = upcoming.bookings.flatMap((b) => {
    const event = toEvent(b);
    return event ? [event] : [];
  });

  const seen = new Set(items.map((i) => i.externalId));
  const held = new Set(
    ctx.open
      .filter((o) => o.kind === "event" && !seen.has(o.externalId))
      .map((o) => o.externalId)
  );
  if (held.size > 0) {
    const cancelled = await bookingsIn(http, secret, "cancelled", from, to);
    if (!cancelled.complete) complete = false;
    for (const b of cancelled.bookings) {
      if (!held.has(b.uid)) continue;
      const event = toEvent(b);
      if (event) items.push({ ...event, state: "done" });
    }
  }
  return { items, complete };
};
