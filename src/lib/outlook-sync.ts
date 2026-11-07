import { Client } from "@microsoft/microsoft-graph-client";
import type { Prisma } from "@prisma/client";

import { convertToUTC, newDate, newDateFromYMD } from "@/lib/date-utils";
import { eventRowId, lockFeed } from "@/lib/feed-replace";
import { logger } from "@/lib/logger";
import {
  convertOutlookRecurrenceToRRule,
  getOutlookClient,
} from "@/lib/outlook-calendar";
import { prisma } from "@/lib/prisma";

interface OutlookAttendee {
  emailAddress: {
    address: string;
    name: string;
  };
  status: {
    response: string;
  };
}

interface OutlookEvent {
  id: string;
  subject?: string;
  body?: {
    content: string;
  };
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
  recurrence?: {
    pattern: {
      type: string;
      interval: number;
      month?: number;
      dayOfMonth?: number;
      daysOfWeek?: string[];
      firstDayOfWeek?: string;
      index?: string;
    };
    range: {
      type: string;
      startDate: string;
      endDate?: string;
      numberOfOccurrences?: number;
    };
  };
  isAllDay?: boolean;
  showAs?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  isOrganizer?: boolean;
  attendees?: OutlookAttendee[];
  seriesMasterId?: string;
}
/**
 * January 1 of last year through December 31 of next year. Worked out on each
 * sync, not once at import: the worker runs for months, and a window fixed at
 * startup would stop reaching new events.
 */
export function outlookSyncWindow(now: Date = newDate()) {
  return {
    timeMin: newDateFromYMD(now.getFullYear() - 1, 0, 1),
    timeMax: newDateFromYMD(now.getFullYear() + 1, 11, 31),
  };
}
const PAGE_SIZE = 200;

const LOG_SOURCE = "OutlookSync";

// Helper to create base event data shared between master and instance events
export function createBaseEventData(
  event: OutlookEvent,
  feedId: string,
  isRecurring: boolean,
  isMaster: boolean
) {
  let start, end;

  // Handle all-day events specially
  if (event.isAllDay) {
    // Extract just the date part without time
    const startStr = event.start.dateTime.split("T")[0];
    const endStr = event.end.dateTime.split("T")[0];

    // Create dates at local midnight for all-day events
    // This ensures they display on the correct day in the calendar
    start = new Date(
      parseInt(startStr.split("-")[0]),
      parseInt(startStr.split("-")[1]) - 1,
      parseInt(startStr.split("-")[2]),
      0,
      0,
      0
    );

    end = new Date(
      parseInt(endStr.split("-")[0]),
      parseInt(endStr.split("-")[1]) - 1,
      parseInt(endStr.split("-")[2]),
      0,
      0,
      0
    );
  } else {
    // Regular events use the normal UTC conversion
    start = convertToUTC(event.start.dateTime, event.start.timeZone);
    end = convertToUTC(event.end.dateTime, event.end.timeZone);
  }

  return {
    feedId,
    externalEventId: event.id,
    title: event.subject || "Untitled Event",
    description: event.body?.content || null,
    start,
    end,
    location: event.location?.displayName || null,
    isRecurring,
    isMaster,
    allDay: event.isAllDay || false,
    status: event.showAs || "busy",
    created: event.createdDateTime ? newDate(event.createdDateTime) : newDate(),
    lastModified: event.lastModifiedDateTime
      ? newDate(event.lastModifiedDateTime)
      : newDate(),
    sequence: 0,
    organizer: event.isOrganizer ? { set: { email: "" } } : { set: null },
    attendees: {
      set: event.attendees
        ? event.attendees.map((a: OutlookAttendee) => ({
            email: a.emailAddress.address,
            name: a.emailAddress.name,
            status: a.status.response,
          }))
        : [],
    },
  };
}

// Helper to save an event to the database
export async function saveEventToDatabase(
  eventData: Prisma.CalendarEventCreateInput | Prisma.CalendarEventUpdateInput,
  feedId: string,
  externalEventId: string,
  isMaster: boolean = false
) {
  const existingEvent = await prisma.calendarEvent.findFirst({
    where: {
      feedId,
      externalEventId,
      ...(isMaster ? { isMaster: true } : {}),
    },
  });

  if (existingEvent) {
    return await prisma.calendarEvent.update({
      where: { id: existingEvent.id },
      data: eventData as Prisma.CalendarEventUpdateInput,
    });
  }

  return await prisma.calendarEvent.create({
    data: {
      ...(eventData as Prisma.CalendarEventCreateInput),
      id: eventRowId(feedId, externalEventId),
    },
  });
}

// Helper to fetch all events from Outlook with pagination
export async function fetchAllEvents(
  client: Client,
  calendarId: string,
  syncToken?: string | null,
  forceFullSync?: boolean
) {
  let allEvents = [];
  let nextLink = null;

  // Initial request - use delta query if sync token is provided
  const apiPath = `/me/calendars/${calendarId}/calendarView/delta`;
  const queryParams = [];

  // Always include startDateTime and endDateTime as required by the API

  if (syncToken && !forceFullSync) {
    logger.debug(
      "Using delta query for incremental sync",
      undefined,
      LOG_SOURCE
    );
    queryParams.push(`$deltatoken=${syncToken}`);
  } else {
    const { timeMin, timeMax } = outlookSyncWindow();
    queryParams.push(`startDateTime=${timeMin.toISOString()}`);
    queryParams.push(`endDateTime=${timeMax.toISOString()}`);
  }

  let response = await client
    .api(apiPath + (queryParams.length > 0 ? `?${queryParams.join("&")}` : ""))
    .header("Prefer", `odata.maxpagesize=${PAGE_SIZE}`)
    .get();

  allEvents = response.value;
  nextLink = response["@odata.nextLink"];
  let deltaLink = response["@odata.deltaLink"]; // Track deltaLink from first response

  // Handle pagination
  while (nextLink) {
    logger.debug(
      "Fetching next page of events",
      {
        nextLink,
      },
      LOG_SOURCE
    );
    response = await client
      .api(nextLink)
      .header("Prefer", `odata.maxpagesize=${PAGE_SIZE}`)
      .get();
    allEvents = allEvents.concat(response.value);
    nextLink = response["@odata.nextLink"];

    // Update deltaLink if present in this response
    if (response["@odata.deltaLink"]) {
      deltaLink = response["@odata.deltaLink"];
    }
  }

  logger.debug(
    "Sync completed",
    {
      totalEvents: String(allEvents.length),
      hasDeltaLink: !!deltaLink,
    },
    LOG_SOURCE
  );

  // For delta query, the response includes information about deleted events
  const deletedEvents = allEvents.filter(
    (event: OutlookEvent & { "@removed"?: boolean }) => event["@removed"]
  );
  const activeEvents = allEvents.filter(
    (event: OutlookEvent & { "@removed"?: boolean }) => !event["@removed"]
  );

  return {
    events: activeEvents,
    deletedEventIds: deletedEvents.map((event: OutlookEvent) => event.id),
    nextSyncToken: deltaLink?.split("deltatoken=")[1],
  };
}

// Helper to fetch instances for a recurring event
export async function fetchEventInstances(
  client: Client,
  calendarId: string,
  masterId: string
) {
  let allInstances = [];
  let nextLink = null;
  const { timeMin, timeMax } = outlookSyncWindow();

  // Initial request
  let response = await client
    .api(`/me/calendars/${calendarId}/events/${masterId}/instances`)
    .query({
      startDateTime: timeMin.toISOString(),
      endDateTime: timeMax.toISOString(),
    })
    .select("id,subject,start,end,body,location,seriesMasterId")
    .orderby("start/dateTime")
    .top(PAGE_SIZE)
    .get();

  allInstances = response.value;
  nextLink = response["@odata.nextLink"];

  // Handle pagination
  while (nextLink) {
    logger.debug(
      "Fetching next page of instances",
      {
        nextLink,
      },
      LOG_SOURCE
    );
    response = await client.api(nextLink).get();
    allInstances = allInstances.concat(response.value);
    nextLink = response["@odata.nextLink"];
  }

  return allInstances;
}

// Helper to process a master event and its instances
export async function processMasterEvent(
  client: Client,
  masterEvent: OutlookEvent,
  feed: { id: string; url: string }
) {
  const processedIds = new Set<string>();
  processedIds.add(masterEvent.id);

  try {
    // Create master event data
    const masterEventData = {
      ...createBaseEventData(masterEvent, feed.id, true, true),
      recurrenceRule: masterEvent.recurrence
        ? convertOutlookRecurrenceToRRule(masterEvent.recurrence)
        : null,
      masterEventId: null,
      recurringEventId: null,
    };

    // Save master event
    const savedMaster = await saveEventToDatabase(
      masterEventData,
      feed.id,
      masterEvent.id,
      true
    );
    // Fetch and process instances
    const instances = await fetchEventInstances(
      client,
      feed.url,
      masterEvent.id
    );

    // Process each instance
    for (const instance of instances) {
      try {
        processedIds.add(instance.id);

        const instanceData = {
          ...createBaseEventData(instance, feed.id, true, false),
          recurrenceRule: masterEvent.recurrence
            ? convertOutlookRecurrenceToRRule(masterEvent.recurrence)
            : null,
          recurringEventId: masterEvent.id,
          masterEventId: savedMaster.id,
        };

        await saveEventToDatabase(instanceData, feed.id, instance.id, false);
      } catch (error) {
        logger.error(
          "Failed to process instance",
          {
            error: error instanceof Error ? error.message : "Unknown error",
            eventId: instance.id,
            subject: instance.subject,
          },
          LOG_SOURCE
        );
      }
    }
  } catch (error) {
    logger.error(
      "Failed to process master event",
      {
        error: error instanceof Error ? error.message : "Unknown error",
        masterEventId: masterEvent.id,
        masterSubject: masterEvent?.subject || "Unknown",
      },
      LOG_SOURCE
    );
  }

  return processedIds;
}

/**
 * Applies what changed in Graph since `lastSyncToken` (all events in the window
 * without one), row by row. Used right after creating or editing an event; the
 * full sync that replaces a feed's events is `syncOutlookFeed` below.
 */
export async function syncOutlookCalendar(
  client: Client,
  feed: { id: string; url: string },
  lastSyncToken?: string | null
) {
  // Fetch all events
  const {
    events: allEvents,
    deletedEventIds,
    nextSyncToken,
  } = await fetchAllEvents(client, feed.url, lastSyncToken);
  logger.debug(
    "Fetched events from Outlook",
    {
      totalCount: allEvents.length,
      deletedEventsCount: deletedEventIds?.length || 0,
      nextSyncToken: nextSyncToken ? "present" : "not present",
    },
    LOG_SOURCE
  );
  // Handle deleted events first if this is a delta sync
  if (lastSyncToken && deletedEventIds?.length > 0) {
    for (const eventId of deletedEventIds) {
      try {
        // Find and delete the event from our database
        const existingEvent = await prisma.calendarEvent.findFirst({
          where: {
            feedId: feed.id,
            externalEventId: eventId,
          },
        });
        if (existingEvent) {
          await prisma.calendarEvent.delete({
            where: { id: existingEvent.id },
          });
        }
      } catch (error) {
        logger.error(
          "Failed to delete event",
          {
            error: error instanceof Error ? error.message : "Unknown error",
            eventId,
          },
          LOG_SOURCE
        );
      }
    }
  }

  // First, collect master events and non-recurring events
  const masterEvents = new Map();
  const nonRecurringEvents = [];

  for (const event of allEvents) {
    if (event.recurrence) {
      masterEvents.set(event.id, event);
    } else if (!event.seriesMasterId) {
      nonRecurringEvents.push(event);
    }
  }

  logger.debug(
    "Retrieved events from Outlook",
    {
      totalCount: allEvents.length,
      masterEventsCount: masterEvents.size,
      nonRecurringCount: nonRecurringEvents.length,
      deletedEventsCount: deletedEventIds?.length || 0,
      nextSyncToken: nextSyncToken ? "present" : "not present",
    },
    LOG_SOURCE
  );

  // Process each event
  const processedEventIds = new Set<string>();

  // First, process non-recurring events
  for (const event of nonRecurringEvents) {
    try {
      processedEventIds.add(event.id);

      const eventData = {
        ...createBaseEventData(event, feed.id, false, false),
        recurrenceRule: null,
        masterEventId: null,
        recurringEventId: null,
      };

      await saveEventToDatabase(eventData, feed.id, event.id);
    } catch (error) {
      logger.error(
        "Failed to process non-recurring event",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          eventId: event.id,
          subject: event.subject,
        },
        LOG_SOURCE
      );
    }
  }

  // Then, process recurring events
  for (const [, masterEvent] of masterEvents) {
    const processedIds = await processMasterEvent(client, masterEvent, feed);
    processedIds.forEach((id) => processedEventIds.add(id));
  }

  return { processedEventIds, nextSyncToken };
}

/** A calendar as Graph has it, read in full before the database is touched. */
export interface OutlookCalendarSnapshot {
  singles: OutlookEvent[];
  masters: OutlookEvent[];
  instances: Map<string, OutlookEvent[]>;
  nextSyncToken?: string;
}

/**
 * Reads every event in the window and every instance of each series. Any
 * Graph failure (a 429, a timeout, an expired token) throws, so a partial read
 * never replaces the stored events.
 */
export async function fetchOutlookCalendar(
  client: Client,
  calendarId: string
): Promise<OutlookCalendarSnapshot> {
  const { events, nextSyncToken } = await fetchAllEvents(client, calendarId, null, true);
  const singles: OutlookEvent[] = [];
  const masters: OutlookEvent[] = [];
  for (const event of events as OutlookEvent[]) {
    if (event.recurrence) masters.push(event);
    else if (!event.seriesMasterId) singles.push(event);
  }
  const instances = new Map<string, OutlookEvent[]>();
  for (const master of masters) {
    instances.set(master.id, await fetchEventInstances(client, calendarId, master.id));
  }
  return { singles, masters, instances, nextSyncToken };
}

/**
 * The feed's rows for a snapshot: one-off events, then each series' master and
 * its instances, linked by `masterEventId` and carrying the series' RRULE. Row
 * ids are stable (lib/feed-replace.ts); an event Graph lists twice is written once.
 */
export function outlookFeedRows(
  feedId: string,
  snapshot: OutlookCalendarSnapshot
): Prisma.CalendarEventCreateManyInput[] {
  const rows: Prisma.CalendarEventCreateManyInput[] = [];
  const seen = new Set<string>();
  const add = (externalId: string, row: Record<string, unknown>) => {
    if (seen.has(externalId)) return;
    seen.add(externalId);
    rows.push({ ...row, id: eventRowId(feedId, externalId) } as Prisma.CalendarEventCreateManyInput);
  };

  for (const event of snapshot.singles) {
    add(event.id, {
      ...createBaseEventData(event, feedId, false, false),
      recurrenceRule: null,
      masterEventId: null,
      recurringEventId: null,
    });
  }
  for (const master of snapshot.masters) {
    const rule = master.recurrence
      ? convertOutlookRecurrenceToRRule(master.recurrence)
      : null;
    add(master.id, {
      ...createBaseEventData(master, feedId, true, true),
      recurrenceRule: rule,
      masterEventId: null,
      recurringEventId: null,
    });
    for (const instance of snapshot.instances.get(master.id) ?? []) {
      add(instance.id, {
        ...createBaseEventData(instance, feedId, true, false),
        recurrenceRule: rule,
        recurringEventId: master.id,
        masterEventId: eventRowId(feedId, master.id),
      });
    }
  }
  return rows;
}

const INSERT_BATCH = 500;

/**
 * Syncs one Outlook feed in full: the feed list's sync button and the
 * background loop (lib/sigwald/job-sync-runner.ts). Graph is read completely
 * first, then the feed's events are replaced in one locked transaction, so a
 * failed or partial read keeps the last good events. A failure is written to
 * `CalendarFeed.error` and rethrown.
 */
export async function syncOutlookFeed(feedId: string): Promise<{ events: number }> {
  const feed = await prisma.calendarFeed.findUnique({ where: { id: feedId } });
  if (!feed || feed.type !== "OUTLOOK" || !feed.accountId || !feed.url || !feed.userId) {
    throw new Error(`Feed ${feedId} is not a connected Outlook calendar`);
  }
  try {
    const client = await getOutlookClient(feed.accountId, feed.userId);
    const snapshot = await fetchOutlookCalendar(client, feed.url);
    const rows = outlookFeedRows(feed.id, snapshot);
    await prisma.$transaction(
      async (tx) => {
        await lockFeed(tx, feed.id);
        await tx.calendarEvent.deleteMany({ where: { feedId: feed.id } });
        for (let i = 0; i < rows.length; i += INSERT_BATCH) {
          await tx.calendarEvent.createMany({ data: rows.slice(i, i + INSERT_BATCH) });
        }
        await tx.calendarFeed.update({
          where: { id: feed.id },
          data: {
            lastSync: newDate(),
            error: null,
            ...(snapshot.nextSyncToken ? { syncToken: snapshot.nextSyncToken } : {}),
          },
        });
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
    logger.info("Outlook feed synced", { feedId, events: rows.length }, LOG_SOURCE);
    return { events: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.calendarFeed
      .update({ where: { id: feed.id }, data: { error: message.slice(0, 500) } })
      .catch(() => {});
    throw error;
  }
}
