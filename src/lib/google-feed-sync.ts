/**
 * Syncs one Google Calendar feed into CalendarEvent rows. Used by the add and
 * sync routes (api/calendar/google), right after connecting an account, and by
 * the background loop (lib/sigwald/job-sync-runner.ts).
 *
 * Everything that talks to Google happens before the database is touched, and
 * the replace is one transaction, so a failed sync keeps the feed's last good
 * events and records the failure on `CalendarFeed.error`.
 *
 * Recurring series keep a master row (`isMaster`, carrying the RRULE) and
 * instance rows linked to it by `masterEventId`: deleting a series removes the
 * master and the cascade takes its instances (lib/calendar-db.ts).
 */
import type { calendar_v3 } from "googleapis";

import { createAllDayDate, newDate, newDateFromYMD } from "@/lib/date-utils";
import { getGoogleCalendarClient } from "@/lib/google-calendar";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "GoogleFeedSync";

type GoogleEvent = calendar_v3.Schema$Event;
type Db = Pick<typeof prisma, "calendarEvent">;

/**
 * The RRULE line of a Google `recurrence` array. A yearly rule gets the start
 * date's BYMONTH and BYMONTHDAY, which the calendar's rrule expansion needs.
 */
export function processRecurrenceRule(
  recurrence: string[] | null | undefined,
  startDate?: Date
): string | undefined {
  const rrule = recurrence?.find((r) => r.startsWith("RRULE:"));
  if (!rrule) return undefined;
  if (!rrule.includes("FREQ=YEARLY") || !startDate) return rrule;
  if (rrule.includes("BYMONTH=") && rrule.includes("BYMONTHDAY=")) return rrule;

  const parts = rrule
    .split(";")
    .filter((p) => !p.startsWith("BYMONTH=") && !p.startsWith("BYMONTHDAY="));
  parts.push(`BYMONTH=${startDate.getMonth() + 1}`);
  parts.push(`BYMONTHDAY=${startDate.getDate()}`);
  return parts.join(";");
}

/** This year's start through a year from now, so next month is always there. */
export function syncWindow(now: Date = newDate()): { timeMin: string; timeMax: string } {
  const timeMax = new Date(now);
  timeMax.setFullYear(timeMax.getFullYear() + 1);
  return {
    timeMin: newDateFromYMD(now.getFullYear(), 0, 1).toISOString(),
    timeMax: timeMax.toISOString(),
  };
}

function eventRecord(event: GoogleEvent, feedId: string) {
  const allDay = !event.start?.dateTime;
  const start = allDay
    ? createAllDayDate(event.start?.date || "")
    : newDate(event.start?.dateTime || "");
  const end = allDay
    ? createAllDayDate(event.end?.date || "")
    : newDate(event.end?.dateTime || event.end?.date || "");
  return {
    feedId,
    externalEventId: event.id,
    title: event.summary || "Untitled Event",
    description: event.description || "",
    start,
    end,
    location: event.location,
    allDay,
    status: event.status,
    sequence: event.sequence,
    created: event.created ? newDate(event.created) : undefined,
    lastModified: event.updated ? newDate(event.updated) : undefined,
    organizer: event.organizer
      ? { name: event.organizer.displayName, email: event.organizer.email }
      : undefined,
    attendees: event.attendees?.map((a) => ({
      name: a.displayName,
      email: a.email,
      status: a.responseStatus,
    })),
  };
}

const hasStart = (e: GoogleEvent) => !!(e.start?.dateTime || e.start?.date);

/** Replaces a feed's events with `events`, masters first. Returns rows written. */
export async function writeFeedEvents(
  db: Db,
  feedId: string,
  events: GoogleEvent[],
  masters: Map<string, GoogleEvent>
): Promise<number> {
  await db.calendarEvent.deleteMany({ where: { feedId } });

  const masterIds = new Map<string, string>();
  for (const [recurringId, master] of masters) {
    if (!hasStart(master)) continue;
    const base = eventRecord(master, feedId);
    const row = await db.calendarEvent.create({
      data: {
        ...base,
        externalEventId: recurringId,
        isRecurring: true,
        isMaster: true,
        recurrenceRule: processRecurrenceRule(master.recurrence, base.start),
      },
    });
    masterIds.set(recurringId, row.id);
  }

  let written = masterIds.size;
  for (const event of events) {
    if (!hasStart(event)) continue;
    const base = eventRecord(event, feedId);
    const masterEventId = event.recurringEventId
      ? masterIds.get(event.recurringEventId)
      : undefined;
    await db.calendarEvent.create({
      data: {
        ...base,
        isRecurring: !!event.recurringEventId,
        isMaster: false,
        masterEventId,
        recurringEventId: event.recurringEventId,
        recurrenceRule: masterEventId
          ? undefined
          : processRecurrenceRule(event.recurrence, base.start),
      },
    });
    written += 1;
  }
  return written;
}

async function fetchFromGoogle(
  client: calendar_v3.Calendar,
  calendarId: string
): Promise<{ events: GoogleEvent[]; masters: Map<string, GoogleEvent> }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.events.list({
      calendarId,
      ...syncWindow(),
      singleEvents: true,
      orderBy: "startTime",
      pageToken,
    });
    events.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  // A master we can't read only costs its instances the link; they still show.
  const masters = new Map<string, GoogleEvent>();
  for (const event of events) {
    const id = event.recurringEventId;
    if (!id || masters.has(id)) continue;
    try {
      const res = await client.events.get({ calendarId, eventId: id });
      masters.set(id, res.data);
    } catch (error) {
      logger.warn(
        "Couldn't read a recurring event's master",
        { calendarId, eventId: id, error: error instanceof Error ? error.message : String(error) },
        LOG_SOURCE
      );
    }
  }
  return { events, masters };
}

/**
 * Syncs one Google feed. Throws when the feed isn't a usable Google feed or
 * Google fails; the failure is written to the feed first.
 */
export async function syncGoogleFeed(feedId: string): Promise<{ events: number }> {
  const feed = await prisma.calendarFeed.findUnique({ where: { id: feedId } });
  if (!feed || feed.type !== "GOOGLE" || !feed.accountId || !feed.url || !feed.userId) {
    throw new Error(`Feed ${feedId} is not a connected Google calendar`);
  }

  try {
    const client = await getGoogleCalendarClient(feed.accountId, feed.userId);
    const { events, masters } = await fetchFromGoogle(client, feed.url);
    const written = await prisma.$transaction(
      async (tx) => {
        const n = await writeFeedEvents(tx, feed.id, events, masters);
        await tx.calendarFeed.update({
          where: { id: feed.id },
          data: { lastSync: newDate(), error: null },
        });
        return n;
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
    logger.info("Google feed synced", { feedId, events: written }, LOG_SOURCE);
    return { events: written };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.calendarFeed
      .update({ where: { id: feed.id }, data: { error: message.slice(0, 500) } })
      .catch(() => {});
    throw error;
  }
}

/** Syncs feeds one after another, logging failures instead of throwing. */
export async function syncGoogleFeeds(feedIds: string[]): Promise<void> {
  for (const id of feedIds) {
    try {
      await syncGoogleFeed(id);
    } catch (error) {
      logger.error(
        "Google feed sync failed",
        { feedId: id, error: error instanceof Error ? error.message : String(error) },
        LOG_SOURCE
      );
    }
  }
}
