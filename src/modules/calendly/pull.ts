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

  // Who booked each coming meeting, kept between pulls (the cursor) with the
  // event's stamp, so a pull reads only meetings it hasn't seen or that
  // changed since (a group event gains and loses invitees), and a failed
  // read never takes a name away.
  const known = namesFrom(ctx.cursor);
  const kept = new Map<string, Kept>();
  if (setting.on(ctx.settings, "names")) {
    const coming = active.events.filter(
      (e) => (toDate(e.end_time)?.getTime() ?? 0) > now.getTime()
    );
    let reads = 0;
    for (const e of coming) {
      const had = known[e.uri];
      if (had) kept.set(e.uri, had);
      if (had?.stamp === stampOf(e) || reads >= MAX_NAME_READS) continue;
      reads += 1;
      try {
        kept.set(e.uri, {
          stamp: stampOf(e),
          names: await inviteeNames(http, secret, e.uri),
        });
      } catch (error) {
        if (!isConnectorError(error)) throw error;
      }
    }
  }

  const items: PulledEvent[] = active.events.flatMap((e) => {
    const event = toEvent(e, kept.get(e.uri)?.names ?? []);
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
  return { items, complete, cursor: { names: Object.fromEntries(kept) } };
};

/** An event's names, and the stamp of the event they were read from. */
interface Kept {
  stamp: string;
  names: string[];
}

/** What changes when a booking does: its last update and its invitee count. */
function stampOf(e: CalendlyEvent): string {
  return `${e.updated_at ?? ""}|${e.invitees_counter?.active ?? ""}`;
}

/** The names a previous pull kept, by event uri. */
function namesFrom(cursor: unknown): Record<string, Kept> {
  const kept = (cursor as { names?: unknown } | null)?.names;
  if (!kept || typeof kept !== "object" || Array.isArray(kept)) return {};
  return Object.fromEntries(
    Object.entries(kept as Record<string, unknown>).filter(
      (e): e is [string, Kept] => {
        const v = e[1] as Partial<Kept> | null;
        return (
          typeof v?.stamp === "string" &&
          Array.isArray(v.names) &&
          v.names.every((n) => typeof n === "string")
        );
      }
    )
  );
}
