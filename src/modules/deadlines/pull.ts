/**
 * Deadline feed's pull: reads each calendar link through the egress (never
 * the iCal subscription's own fetch), parses it with the same parser and the
 * same bounded recurrence expansion as a subscribed calendar, and makes a
 * task per event from two weeks back to the look-ahead.
 */
import { createHash } from "node:crypto";

import { localDay } from "@/lib/date-utils";
import {
  expandIcalEvents,
  normalizeIcalUrl,
  parseIcalEvents,
} from "@/lib/ical-feed";

import {
  type PullFn,
  type PulledTask,
  fact,
  plainText,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const PAST_DAYS = 14;

function linkKey(link: string): string {
  return createHash("sha256").update(link).digest("hex").slice(0, 10);
}

function linkLabel(link: string): string {
  try {
    const url = new URL(link);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "Calendar link";
  }
}

export const pullDeadlines: PullFn = async ({ http, settings, now }) => {
  const links = setting.list(settings, "links");
  const only = setting.text(settings, "only").toLowerCase();
  const atEnd = setting.text(settings, "dueAt") === "end";
  const ahead = setting.number(settings, "ahead", 60);
  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const until = new Date(now.getTime() + ahead * 86_400_000);

  const items: PulledTask[] = [];
  let complete = true;
  for (const raw of links) {
    const link = normalizeIcalUrl(raw);
    let events;
    try {
      events = expandIcalEvents(
        parseIcalEvents(await http.text(link)),
        from,
        until
      );
    } catch (error) {
      // One broken link mustn't take the others' tasks away, nor its own.
      complete = false;
      if (links.length === 1) throw error;
      continue;
    }
    const key = linkKey(link);
    const label = linkLabel(link);
    for (const e of events) {
      if (e.isMaster || e.status?.toUpperCase() === "CANCELLED") continue;
      const when = atEnd ? e.end : e.start;
      if (when < from || when > until) continue;
      if (only && !e.title.toLowerCase().includes(only)) continue;
      items.push({
        kind: "task",
        // The parser keys each occurrence by its series and original time
        // (uid_<start>), so a moved deadline stays the same task.
        externalId: `${key}:${e.externalEventId ?? `${e.title}@${e.start.toISOString()}`}`,
        title: e.title,
        state: "open",
        url: null,
        description: plainText(e.description),
        // An all-day event names a day (parsed as this machine's midnight):
        // due by that day's end, in the person's zone.
        due: e.allDay ? { date: localDay(e.start) } : { at: when },
        group: { key: `deadlines:link:${key}`, label },
        facts: [...fact("From", label), ...fact("Where", e.location)],
      });
    }
  }
  return { items, complete };
};
