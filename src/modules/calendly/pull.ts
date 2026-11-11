/**
 * Calendly's pull: your active bookings from a day ago to 30 days ahead, as
 * busy events titled with the event type's name. A held booking that is now
 * listed as cancelled comes back done, which takes it off the calendar. One
 * that simply stops being listed is treated as gone.
 */
import {
  type CalendlyEvent,
  eventsIn,
  inviteeNames,
} from "@/lib/connectors/calendly/client";
import { isConnectorError } from "@/lib/connectors/errors";

import {
  type PullFn,
  type PulledEvent,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const DAY = 86_400_000;
/** Coming meetings whose invitees are read, at most. */
const MAX_NAME_READS = 20;

function toEvent(e: CalendlyEvent, names: string[]): PulledEvent | null {
  const start = toDate(e.start_time);
  const end = toDate(e.end_time);
  if (!start || !end) return null;
  const place = e.location?.location?.trim() || null;
  const join = e.location?.join_url?.trim() || null;
  return {
    kind: "event",
    externalId: e.uri,
    title: e.name?.trim() || "Calendly meeting",
    state: "open",
    start,
    end,
    busy: true,
    location: place,
    url: join,
    description: names.length > 0 ? `With ${names.join(", ")}` : null,
    facts: [...fact("Booked by", names.join(", "))],
    updatedAt: toDate(e.updated_at),
  };
}

export const pullCalendly: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const userUri = config.userUri;
  if (!userUri) return { items: [], complete: false };
  const from = new Date(now.getTime() - DAY);
  const to = new Date(now.getTime() + 30 * DAY);

  const active = await eventsIn(http, secret, userUri, "active", from, to);
  let complete = active.complete;

  const names = new Map<string, string[]>();
  if (setting.on(ctx.settings, "names")) {
    const coming = active.events
      .filter((e) => (toDate(e.end_time)?.getTime() ?? 0) > now.getTime())
      .slice(0, MAX_NAME_READS);
    for (const e of coming) {
      try {
        names.set(e.uri, await inviteeNames(http, secret, e.uri));
      } catch (error) {
        if (!isConnectorError(error)) throw error;
      }
    }
  }

  const items: PulledEvent[] = active.events.flatMap((e) => {
    const event = toEvent(e, names.get(e.uri) ?? []);
    return event ? [event] : [];
  });

  const seen = new Set(items.map((i) => i.externalId));
  const held = new Set(
    ctx.open
      .filter((o) => o.kind === "event" && !seen.has(o.externalId))
      .map((o) => o.externalId)
  );
  if (held.size > 0) {
    const canceled = await eventsIn(
      http,
      secret,
      userUri,
      "canceled",
      from,
      to
    );
    if (!canceled.complete) complete = false;
    for (const e of canceled.events) {
      if (!held.has(e.uri)) continue;
      const event = toEvent(e, []);
      if (event) items.push({ ...event, state: "done" });
    }
  }
  return { items, complete };
};
