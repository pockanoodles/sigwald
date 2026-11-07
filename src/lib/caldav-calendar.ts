import { CalendarEvent, ConnectedAccount, Prisma } from "@prisma/client";
import ICAL from "ical.js";
import { DAVResponse } from "tsdav";

import {
  CalDAVConnection,
  connectionFromAccount,
  deleteObject,
  getCalendarCtag,
  getObjectText,
  putObject,
  queryEvents,
  resolveObjectUrl,
} from "@/lib/caldav/client";
import { brand } from "@/lib/brand";
import { newDate, newDateFromYMD } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { CalendarEventWithFeed } from "@/types/calendar";

import { convertVEventToCalendarEvent } from "./caldav-helpers";
import { seriesOccurrences } from "./ical-recurrence";
import {
  CalDAVCalendarObject,
  CalendarEventInput,
  SyncResult,
} from "./caldav-interfaces";
import {
  buildVTimezoneComponent,
  isValidTimeZone,
  zonedTime,
} from "./caldav-vtimezone";

const LOG_SOURCE = "CalDAVCalendar";

/** The slice of the (extended) Prisma client that sync writes go through, so they can run inside a transaction. */
type SyncDb = Pick<typeof prisma, "calendarEvent">;

/**
 * Build a RECURRENCE-ID / EXDATE property that points at a single instance of a
 * recurring master, using the SAME value type as the master's DTSTART so the
 * CalDAV server can pair the exception with the correct instance.
 *
 * - Timed master (DATE-TIME DTSTART): emit a UTC date-time (`...Z`) so the
 *   reference is an unambiguous absolute instant regardless of the client's
 *   timezone (GitHub issue #135).
 * - All-day master (`VALUE=DATE` DTSTART): emit a floating `VALUE=DATE` value so
 *   it matches the master's date-typed instances (GitHub issue #100). A UTC
 *   date-time here would not match an all-day instance and the single-instance
 *   update/delete would silently fail.
 *
 * @param name "recurrence-id" or "exdate"
 * @param masterVevent the parsed master VEVENT (used to read DTSTART's type)
 * @param instanceStart the instance's start instant
 */
function buildInstanceReference(
  name: "recurrence-id" | "exdate",
  masterVevent: ICAL.Component,
  instanceStart: Date
): ICAL.Property {
  const masterDtstart = masterVevent.getFirstProperty("dtstart");
  const masterStartValue = masterDtstart?.getFirstValue() as
    | ICAL.Time
    | undefined;
  const masterIsAllDay = masterStartValue?.isDate === true;
  const masterTzid = masterDtstart?.getParameter("tzid") as string | undefined;

  const property = new ICAL.Property(name);

  // Let the ICAL.Time value's own type drive the VALUE parameter: a date-typed
  // value serializes as `VALUE=DATE` automatically, and a date-time value omits
  // VALUE (DATE-TIME is the default). Calling setParameter("value", ...) on top
  // of a typed value emits an invalid duplicate `VALUE=date;VALUE=DATE` that
  // strict servers reject (see GitHub issue #100), so we deliberately do not.
  if (masterIsAllDay) {
    // Match the master's floating DATE value (no time, no Z).
    const dateString = instanceStart.toISOString().split("T")[0];
    property.setValue(ICAL.Time.fromDateString(dateString));
  } else if (masterTzid && isValidTimeZone(masterTzid)) {
    // Master DTSTART is TZID-qualified with a resolvable IANA zone: emit the
    // exception with the SAME TZID and the instance's wall-clock in that zone,
    // so servers that key exceptions by the DTSTART value form pair it with the
    // right instance (GitHub issue #135). A server-supplied custom/non-IANA
    // TZID is not usable here, so we fall through to an unambiguous UTC value
    // rather than throwing (which, in the delete path, would leave the master
    // un-updated after the remote DELETE already fired).
    property.setValue(zonedTime(instanceStart, masterTzid));
    property.setParameter("tzid", masterTzid);
  } else {
    // Timed master without a TZID (UTC `Z` form): match with a UTC date-time.
    property.setValue(ICAL.Time.fromJSDate(instanceStart, true));
  }

  return property;
}

/**
 * Service for interacting with CalDAV servers
 */
export class CalDAVCalendarService {
  private conn: CalDAVConnection | null = null;
  /**
   * Each series master's own VEVENT, from the sync that read it, so the series
   * expands in its time zone (see expandMasterEvent).
   */
  private masterSources = new WeakMap<CalendarEvent, ICAL.Component>();

  /**
   * Creates a new CalDAV calendar service
   * @param account Connected account with CalDAV credentials
   */
  constructor(private account: ConnectedAccount) {}

  /**
   * The account's CalDAV endpoint and credential, built once and reused so the
   * transport layer can cache a tsdav client against it. Built lazily rather
   * than in the constructor, because a feed can be constructed for an account
   * with no CalDAV URL and should fail when it tries to talk, not before.
   *
   * Everything that leaves this process goes through `@/lib/caldav/client`;
   * this class no longer builds requests or auth headers of its own.
   */
  private connection(): CalDAVConnection {
    if (!this.conn) {
      this.conn = connectionFromAccount(this.account);
    }
    return this.conn;
  }

  private async expandRecurringEvents(
    masterEvents: CalendarEvent[]
  ): Promise<CalendarEvent[]> {
    const instances: CalendarEvent[] = [];
    for (const masterEvent of masterEvents) {
      if (masterEvent.isRecurring) {
        const instanceEvents = await this.expandMasterEvent(masterEvent);
        instances.push(...instanceEvents);
      }
    }
    return instances;
  }

  private async expandMasterEvent(
    masterEvent: CalendarEvent
  ): Promise<CalendarEvent[]> {
    //todo expand master event locally and return all instances
    if (!masterEvent.isRecurring || !masterEvent.recurrenceRule) {
      return [];
    }

    try {
      // Import RRule from the rrule library
      const { RRule } = await import("rrule");

      // Define the time range for expansion (1 year back to 1 year ahead)
      const timeRange = this.getTimeRange();

      // A series read in this sync expands from its own VEVENT, in its time
      // zone, without its EXDATEs and with its RDATEs. rrule anchored on the UTC
      // start (the fallback, for a master with no VEVENT at hand) moves a
      // weekly 9:00 event to 8:00 once daylight saving ends, and ignores EXDATE.
      const source = this.masterSources.get(masterEvent);
      let expanded: Date[];
      if (source) {
        expanded =
          seriesOccurrences(source, timeRange.start, timeRange.end, 5000) ?? [];
      } else {
        const options = RRule.parseString(masterEvent.recurrenceRule);
        options.dtstart = masterEvent.start;
        expanded = new RRule(options).between(timeRange.start, timeRange.end, true);
      }

      const occurrences = expanded
        // The master row is persisted as a real event and already represents the
        // series' first occurrence (its start/end come straight from DTSTART/DTEND).
        // RRULE expansion is inclusive of DTSTART, so emitting that occurrence again
        // would write a second row for the same instant — the duplicate every reader
        // saw, since no read path filters `isMaster` out.
        .filter((date) => date.getTime() !== masterEvent.start.getTime());

      // Create instance events for each occurrence
      const instanceEvents: CalendarEvent[] = occurrences
        .map((date) => {
          // Calculate the duration of the master event
          const duration =
            masterEvent.end.getTime() - masterEvent.start.getTime();

          // Create a new end date for this instance
          const endDate = new Date(date.getTime() + duration);

          // Create the instance event
          return {
            ...masterEvent,
            externalEventId: masterEvent.externalEventId,
            start: date,
            end: endDate,
            isRecurring: true,
            recurrenceRule: masterEvent.recurrenceRule,
            isMaster: false,
            recurringEventId: masterEvent.externalEventId,
          };
        })
        .filter(Boolean) as CalendarEvent[];

      return instanceEvents;
    } catch (error) {
      logger.error(
        "Failed to expand master event",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          eventId: masterEvent.id,
          title: masterEvent.title,
          recurrenceRule: masterEvent.recurrenceRule,
        },
        LOG_SOURCE
      );
      return [];
    }
  }

  /**
   * Fetches events from a CalDAV calendar for a specific time range
   * @param start Start date
   * @param end End date
   * @param calendarPath Path to the calendar
   * @returns Array of calendar events
   */
  private async getEvents(
    start: Date,
    end: Date,
    calendarPath: string
  ): Promise<CalendarEvent[]> {
    // Failures propagate: an empty list means "the calendar is empty", never
    // "the fetch failed", or a sync would wipe the feed on any outage.
    const masterEvents = await this.fetchMasterEvents(start, end, calendarPath);

    const instanceEvents = await this.expandRecurringEvents(masterEvents);

    return [...masterEvents, ...instanceEvents];
  }

  /**
   * Fetch master events from the CalDAV server
   * @param start Start date
   * @param end End date
   * @param calendarPath Path to the calendar
   * @returns Array of master events
   */
  private async fetchMasterEvents(
    start: Date,
    end: Date,
    calendarPath: string
  ): Promise<CalendarEvent[]> {
    // No expand: the server returns masters, and expandRecurringEvents derives
    // the instances locally.
    const calendarObjects = await queryEvents(this.connection(), {
      calendarUrl: calendarPath,
      start,
      end,
      expand: false,
    });

    // Process the calendar objects to extract master events
    return await this.processCalendarObjects(calendarObjects);
  }

  /**
   * Process calendar objects returned by the CalDAV server
   * @param calendarObjects Calendar objects returned by the server
   * @param mode Whether to prioritize master events or instance events
   * @returns Array of calendar events
   */
  private async processCalendarObjects(
    calendarObjects: DAVResponse[]
  ): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    // Track UIDs to avoid duplicates
    const processedUids = new Set<string>();

    // Convert DAVResponse objects to CalDAVCalendarObject format
    const calendarData = this.extractCalendarData(calendarObjects);

    for (const obj of calendarData) {
      try {
        // Extract iCalendar data
        const icalData = this.extractICalData(obj);
        if (!icalData) continue;

        // Parse the iCalendar data
        const vevents = this.parseICalData(icalData, obj.url);
        if (!vevents || vevents.length === 0) continue;

        // Process each VEVENT component
        for (const vevent of vevents) {
          // Extract event properties
          const { uid, hasRRule, hasRecurrenceId } =
            this.extractEventProperties(vevent);

          // Convert VEVENT to CalendarEvent
          const event = convertVEventToCalendarEvent(vevent);

          // Set event properties based on its type
          this.setEventTypeProperties(
            event,
            uid,
            hasRRule,
            hasRecurrenceId,
            processedUids
          );
          if (event.isMaster) this.masterSources.set(event, vevent);
          events.push(event);
        }
      } catch (error) {
        logger.error(
          "Failed to process calendar object",
          {
            error: error instanceof Error ? error.message : "Unknown error",
            url: obj.url || "unknown",
          },
          LOG_SOURCE
        );
      }
    }

    return events;
  }

  /**
   * Extract calendar data from DAVResponse objects
   * @param calendarObjects Calendar objects returned by the server
   * @returns Array of calendar objects
   */
  private extractCalendarData(
    calendarObjects: DAVResponse[]
  ): CalDAVCalendarObject[] {
    return calendarObjects.map((obj: DAVResponse) => {
      // Get calendar data, which might be in different formats
      const calendarDataProp =
        obj.props?.["calendar-data"] || obj.props?.calendarData || "";

      return {
        url: obj.href || "",
        etag: obj.props?.getetag || "",
        data: calendarDataProp,
      };
    });
  }

  /**
   * Extract iCalendar data from a calendar object
   * @param obj Calendar object
   * @returns iCalendar data as string, or empty string if extraction fails
   */
  private extractICalData(obj: CalDAVCalendarObject): string {
    let icalData = "";
    if (typeof obj.data === "string") {
      icalData = obj.data;
    } else if (typeof obj.data === "object" && obj.data !== null) {
      // Try to get _cdata property if it exists
      const dataObj = obj.data as Record<string, unknown>;
      if ("_cdata" in dataObj && typeof dataObj._cdata === "string") {
        icalData = dataObj._cdata;
      } else {
        // Try to stringify the object as a fallback
        try {
          icalData = JSON.stringify(obj.data);
        } catch (error) {
          logger.warn(
            "Failed to stringify calendar data",
            {
              url: obj.url,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            LOG_SOURCE
          );
          return ""; // Return empty string to indicate failure
        }
      }
    }

    if (!icalData) {
      logger.warn(
        "Empty iCalendar data",
        { url: obj.url || "unknown" },
        LOG_SOURCE
      );
    }

    return icalData;
  }

  /**
   * Parse iCalendar data and extract VEVENT components
   * @param icalData iCalendar data as string
   * @param url URL of the calendar object (for logging)
   * @returns Array of VEVENT components
   */
  private parseICalData(
    icalData: string,
    url: string
  ): ICAL.Component[] | null {
    try {
      const jcalData = ICAL.parse(icalData);
      const vcalendar = new ICAL.Component(jcalData);
      const vevents = vcalendar.getAllSubcomponents("vevent");
      return vevents;
    } catch (error) {
      logger.error(
        "Failed to parse iCalendar data",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          url,
        },
        LOG_SOURCE
      );
      throw error;
    }
  }

  /**
   * Synchronizes a CalDAV calendar with the local database
   * @param calendarPath Path to the calendar
   * @returns Sync result with added, updated, and deleted events
   */
  /**
   * The collection's CTag, or null if it cannot be determined.
   *
   * A CTag is only an optimization — it lets an unchanged calendar cost one
   * PROPFIND instead of a full sync — so any failure degrades to "unknown"
   * and the full sync proceeds. The transport layer throws; swallowing is
   * this caller's policy, not the client's.
   */
  private async readCtag(calendarPath: string): Promise<string | null> {
    try {
      return await getCalendarCtag(this.connection(), calendarPath);
    } catch (error) {
      logger.warn(
        "Could not read calendar CTag; falling back to a full sync",
        {
          error: error instanceof Error ? error.message : String(error),
          accountId: this.account.id,
        },
        LOG_SOURCE
      );
      return null;
    }
  }

  /**
   * Read a recurring master, add a single-instance exception to it, and write
   * it back.
   *
   * Shared by the two single-instance paths, which differ only in which
   * property they add: `updateEvent` adds a RECURRENCE-ID so the server pairs
   * the edited instance with the series, `deleteEvent` adds an EXDATE so the
   * server drops it. Both were the same 48 lines before.
   *
   * Best-effort by design: if the master cannot be read or has no VEVENT there
   * is nothing to amend, and in the delete path the remote DELETE has already
   * succeeded, so failing here would abort halfway through.
   */
  private async amendMasterWithInstanceReference(params: {
    name: "recurrence-id" | "exdate";
    masterEventUrl: string;
    instanceStart: Date;
  }): Promise<void> {
    const icalData = await getObjectText(
      this.connection(),
      params.masterEventUrl
    );
    if (!icalData) return;

    const vcalendar = new ICAL.Component(ICAL.parse(icalData));
    const vevent = vcalendar.getFirstSubcomponent("vevent");
    if (!vevent) return;

    vevent.addProperty(
      buildInstanceReference(params.name, vevent, params.instanceStart)
    );

    await putObject(this.connection(), {
      url: params.masterEventUrl,
      ical: vcalendar.toString(),
      context: { property: params.name },
    });
  }

  async syncCalendar(
    feedId: string,
    calendarPath: string,
    userId: string,
    options?: { forceFullSync?: boolean }
  ): Promise<SyncResult> {
    try {
      const forceFullSync = options?.forceFullSync ?? false;

      // Get the calendar feed from the database
      const feed = await prisma.calendarFeed.findFirst({
        where: {
          url: calendarPath,
          accountId: this.account.id,
          type: "CALDAV",
          userId,
        },
      });

      if (!feed) {
        throw new Error(`Calendar feed not found for path: ${calendarPath}`);
      }

      let remoteCtag: string | null = null;
      if (!forceFullSync && this.account.caldavUrl) {
        remoteCtag = await this.readCtag(calendarPath);
        if (remoteCtag && feed.ctag === remoteCtag) {
          await prisma.calendarFeed.update({
            where: { id: feed.id, userId },
            data: { lastSync: newDate() },
          });
          return {
            added: [],
            updated: [],
            deleted: [],
            unchanged: true,
          };
        }
      }

      // Define time range for events (1 year back to 1 year ahead)
      const timeRange = this.getTimeRange();

      // Fetch first. Nothing is deleted until the server has answered, so a
      // failed fetch leaves the feed's last good events in place.
      const events = await this.getEvents(
        timeRange.start,
        timeRange.end,
        calendarPath
      );

      const newCtag =
        !forceFullSync && this.account.caldavUrl
          ? await this.readCtag(calendarPath)
          : remoteCtag;

      // Replace the feed's events atomically: either all of the new set lands
      // or the old set stays.
      const result = await prisma.$transaction(
        async (tx) => {
          await tx.calendarEvent.deleteMany({ where: { feedId: feed.id } });

          const created = await this.createAllEvents(events, feed.id, tx);

          await tx.calendarFeed.update({
            where: { id: feed.id, userId },
            data: {
              lastSync: newDate(),
              error: null,
              syncToken: feed.syncToken ? String(feed.syncToken) : null,
              ...(newCtag ? { ctag: newCtag } : {}),
            },
          });

          return created;
        },
        { maxWait: 10_000, timeout: 120_000 }
      );

      return result;
    } catch (error) {
      logger.error(
        "Failed to sync CalDAV calendar",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          calendarPath,
          accountId: this.account.id,
        },
        LOG_SOURCE
      );
      // Record the failure on the feed, but leave ctag, syncToken, lastSync
      // and the stored events alone so the next sync retries from scratch.
      await prisma.calendarFeed
        .updateMany({
          where: { id: feedId, userId },
          data: {
            error:
              error instanceof Error ? error.message : "Failed to sync CalDAV",
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Updates an existing event in a CalDAV calendar
   * @param calendarPath Path to the calendar
   * @param externalEventId ID of the event to update
   * @param event Updated event data
   * @returns Updated calendar event
   */
  async updateEvent(
    eventWithFeed: CalendarEventWithFeed,
    calendarPath: string,
    externalEventId: string,
    event: CalendarEventInput,
    mode: "single" | "series",
    userId: string
  ): Promise<CalendarEvent> {
    try {
      // Create a URL for the event using the externalEventId
      const eventUrl = resolveObjectUrl(calendarPath, externalEventId);

      // Resolve the user's timezone so timed events serialize with a TZID
      // (keeps wall-clock time across DST for recurring events; issue #135).
      const timeZone =
        event.timeZone ?? (await this.resolveUserTimeZone(userId));

      // Generate the iCalendar data
      const icalData = this.convertToICalendar({
        ...event,
        id: externalEventId,
        timeZone,
      });

      try {
        await putObject(this.connection(), {
          url: eventUrl,
          ical: icalData,
          fallback: { mode: "update", url: eventUrl },
          operation: "update",
          context: { calendarPath, eventId: externalEventId, mode },
        });
      } catch (updateError) {
        logger.error(
          "Failed to update event on CalDAV server",
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : "Unknown error",
            stack:
              updateError instanceof Error && updateError.stack
                ? updateError.stack
                : null,
            calendarPath,
            eventUrl,
            mode,
          },
          LOG_SOURCE
        );
        throw updateError;
      }

      // If updating a single instance of a recurring event
      if (mode === "single" && event.isRecurring) {
        // Get the master event
        const masterEvent = await prisma.calendarEvent.findFirst({
          where: {
            externalEventId: externalEventId.split("_")[0],
            feedId: eventWithFeed.feedId,
            isMaster: true,
          },
        });

        // externalEventId is nullable, and without it there is no master URL to
        // amend. The old string interpolation built `.../null.ics` and made a
        // request that could only 404.
        if (
          masterEvent &&
          masterEvent.recurrenceRule &&
          masterEvent.externalEventId
        ) {
          // Create a RECURRENCE-ID for this instance, matching the master
          // DTSTART's value type so the server can pair the exception with the
          // right instance. For timed series use UTC (`...Z`) so it references
          // the same absolute instant regardless of client timezone (GitHub
          // issue #135); for all-day series keep the floating `VALUE=DATE`
          // form the master uses (issue #100).
          await this.amendMasterWithInstanceReference({
            name: "recurrence-id",
            masterEventUrl: resolveObjectUrl(
              calendarPath,
              masterEvent.externalEventId
            ),
            instanceStart: event.start,
          });
        }
      }

      // Sync the calendar to get the updated event
      const syncResult = await this.syncCalendar(
        eventWithFeed.feedId,
        calendarPath,
        userId,
        { forceFullSync: true }
      );

      // Find the updated event in the sync results
      const updatedEvent = syncResult.added.find(
        (e) => e.externalEventId === externalEventId
      );

      if (!updatedEvent) {
        throw new Error("Updated event not found in sync results");
      }

      return updatedEvent;
    } catch (error) {
      logger.error(
        "Failed to update CalDAV event",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          calendarPath,
          eventId: externalEventId,
          eventTitle: event.title,
          mode,
        },
        LOG_SOURCE
      );
      throw error;
    }
  }

  /**
   * Deletes an event from a CalDAV calendar
   * @param calendarPath Path to the calendar
   * @param eventId ID of the event to delete
   * @param mode Whether to delete a single instance or the entire series
   */
  async deleteEvent(
    event: CalendarEventWithFeed,
    calendarPath: string,
    externalEventId: string,
    mode: "single" | "series",
    userId: string
  ): Promise<void> {
    try {
      // Create a URL for the event using the externalEventId
      const eventUrl = resolveObjectUrl(calendarPath, externalEventId);

      try {
        await deleteObject(this.connection(), {
          url: eventUrl,
          fallback: { url: eventUrl },
          context: { calendarPath, eventId: externalEventId, mode },
        });
      } catch (deleteError) {
        logger.error(
          "Failed to delete event on CalDAV server",
          {
            error:
              deleteError instanceof Error
                ? deleteError.message
                : "Unknown error",
            stack:
              deleteError instanceof Error && deleteError.stack
                ? deleteError.stack
                : null,
            calendarPath,
            eventUrl,
            mode,
          },
          LOG_SOURCE
        );
        throw deleteError;
      }

      // If deleting a single instance, we need to handle it differently
      if (mode === "single" && event.isRecurring && event.masterEventId) {
        // Get the master event
        const masterEvent = await prisma.calendarEvent.findFirst({
          where: {
            id: event.masterEventId,
            feedId: event.feedId,
          },
        });

        // externalEventId is nullable, and without it there is no master URL to
        // amend. The old string interpolation built `.../null.ics` and made a
        // request that could only 404.
        if (
          masterEvent &&
          masterEvent.recurrenceRule &&
          masterEvent.externalEventId
        ) {
          // Create an EXDATE for this instance, matching the master DTSTART's
          // value type so the server excludes the right instance. For timed
          // series use UTC (`...Z`) so it matches the master's instants
          // regardless of client timezone (GitHub issue #135); for all-day
          // series keep the floating `VALUE=DATE` form (issue #100).
          await this.amendMasterWithInstanceReference({
            name: "exdate",
            masterEventUrl: resolveObjectUrl(
              calendarPath,
              masterEvent.externalEventId
            ),
            instanceStart: event.start,
          });
        }
      }

      // Sync the calendar to update our local database
      await this.syncCalendar(event.feedId, calendarPath, userId, {
        forceFullSync: true,
      });
    } catch (error) {
      logger.error(
        "Failed to delete CalDAV event",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          calendarPath,
          eventId: externalEventId,
          mode,
        },
        LOG_SOURCE
      );
      throw error;
    }
  }

  /**
   * Looks up the user's IANA timezone from their settings, used to serialize
   * timed events with a `TZID` so recurring events keep wall-clock time across
   * DST (GitHub issue #135). Returns undefined when no setting exists, in which
   * case serialization falls back to UTC.
   */
  private async resolveUserTimeZone(
    userId: string
  ): Promise<string | undefined> {
    try {
      const settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { timeZone: true },
      });
      return settings?.timeZone || undefined;
    } catch (error) {
      logger.warn(
        "Failed to load user timezone for CalDAV serialization; using UTC",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          userId,
        },
        LOG_SOURCE
      );
      return undefined;
    }
  }

  /**
   * Converts an internal event to iCalendar format
   * @param event Calendar event to convert
   * @returns iCalendar data as string
   */
  private convertToICalendar(event: CalendarEventInput): string {
    // Create a new iCalendar component
    const calendar = new ICAL.Component(["vcalendar", [], []]);
    calendar.updatePropertyWithValue("prodid", `-//${brand.name}//EN`);
    calendar.updatePropertyWithValue("version", "2.0");

    // Create the event component
    const vevent = new ICAL.Component(["vevent", [], []]);
    vevent.updatePropertyWithValue("uid", event.id || crypto.randomUUID());
    vevent.updatePropertyWithValue("summary", event.title);

    if (event.description) {
      vevent.updatePropertyWithValue("description", event.description);
    }

    if (event.location) {
      vevent.updatePropertyWithValue("location", event.location);
    }

    // Add start and end times
    const dtstart = new ICAL.Property("dtstart");
    const dtend = new ICAL.Property("dtend");

    if (event.allDay) {
      // A date-typed ICAL.Time already serializes as VALUE=DATE; setting the
      // parameter manually emitted a duplicate/invalid VALUE that strict CalDAV
      // servers (Baikal, Nextcloud) reject, so let ICAL.Time drive it.
      const formatDate = (date: Date) => {
        const dateString = date.toISOString().split("T")[0];
        return ICAL.Time.fromDateString(dateString);
      };

      dtstart.setValue(formatDate(event.start));

      // For all-day events, the end date should be the next day in iCal
      // Make sure we create a new date to avoid mutating the original
      const endDate = new Date(event.end);
      dtend.setValue(formatDate(endDate));
    } else {
      // Serialize timed events with an explicit timezone so other CalDAV
      // clients interpret them at the correct instant AND so recurring events
      // keep their wall-clock time across DST transitions (a fixed-UTC DTSTART +
      // RRULE would drift by an hour after a DST change). See GitHub issue #135.
      //
      // When a user timezone is available we emit `DTSTART;TZID=<zone>` plus a
      // matching VTIMEZONE; otherwise we fall back to UTC (`...Z`), which is
      // still unambiguous for single (non-recurring) events.
      const vtimezone = event.timeZone
        ? buildVTimezoneComponent(event.timeZone)
        : null;

      if (vtimezone && event.timeZone) {
        calendar.addSubcomponent(vtimezone);
        dtstart.setValue(zonedTime(event.start, event.timeZone));
        dtend.setValue(zonedTime(event.end, event.timeZone));
        dtstart.setParameter("tzid", event.timeZone);
        dtend.setParameter("tzid", event.timeZone);
      } else {
        // Floating local time (no `Z`, no `TZID`) would be re-interpreted in
        // each client's own timezone and shift the event; emit UTC instead.
        dtstart.setValue(ICAL.Time.fromJSDate(event.start, true));
        dtend.setValue(ICAL.Time.fromJSDate(event.end, true));
      }
    }

    vevent.addProperty(dtstart);
    vevent.addProperty(dtend);

    // Handle recurring events
    if (event.isRecurring && event.recurrenceRule) {
      // Convert from RRule string format (e.g., "FREQ=DAILY;INTERVAL=1") to iCalendar format
      // The iCalendar format expects just the rule part without the property name
      const rruleValue = event.recurrenceRule;

      // Create a proper RRULE property
      const rruleProp = new ICAL.Property("rrule");

      // Parse the RRule string into an object
      const rruleObj: Record<string, string | number | string[]> = {};
      rruleValue.split(";").forEach((part) => {
        const [key, value] = part.split("=");
        if (key && value) {
          // Handle array values like BYDAY=MO,TU,WE
          if (value.includes(",")) {
            rruleObj[key.toLowerCase()] = value.split(",");
          } else if (!isNaN(Number(value))) {
            // Handle numeric values
            rruleObj[key.toLowerCase()] = Number(value);
          } else {
            // Handle string values
            rruleObj[key.toLowerCase()] = value;
          }
        }
      });

      // Set the value as a jCal-compatible object
      rruleProp.setValue(rruleObj);

      // Add the property to the event
      vevent.addProperty(rruleProp);
    }

    // Add the event to the calendar
    calendar.addSubcomponent(vevent);

    // Return the iCalendar string
    return calendar.toString();
  }

  /**
   * Creates a new event in a CalDAV calendar
   * @param calendarPath Path to the calendar
   * @param event Event data to create
   * @returns Created calendar event
   */
  async createEvent(
    calendarPath: string,
    event: CalendarEventInput,
    userId: string
  ): Promise<CalendarEvent> {
    try {
      // Generate a unique ID for the event if not provided
      const eventId = event.id || crypto.randomUUID();

      // Resolve the user's timezone so timed events serialize with a TZID
      // (keeps wall-clock time across DST for recurring events; issue #135).
      const timeZone =
        event.timeZone ?? (await this.resolveUserTimeZone(userId));

      // Generate the iCalendar data
      const icalData = this.convertToICalendar({
        ...event,
        id: eventId,
        timeZone,
      });

      // Create a URL for the event using the UID
      const eventUrl = resolveObjectUrl(calendarPath, eventId);

      try {
        await putObject(this.connection(), {
          url: eventUrl,
          ical: icalData,
          // Refuse to overwrite: this is a create, not an update.
          ifNoneMatch: true,
          // Note the asymmetry, inherited from upstream: the direct PUT targets
          // the object URL, but the fallback posts to the collection and lets
          // the server name the resource. Update and delete use the object URL
          // for both. Preserved rather than "fixed" while moving the code.
          fallback: { mode: "create", url: calendarPath },
          operation: "create",
          context: { calendarPath, eventId },
        });
      } catch (createError) {
        logger.error(
          "Failed to create event on CalDAV server",
          {
            error:
              createError instanceof Error
                ? createError.message
                : "Unknown error",
            stack:
              createError instanceof Error && createError.stack
                ? createError.stack
                : null,
            calendarPath,
            eventUrl,
          },
          LOG_SOURCE
        );
        throw createError;
      }

      // Get the calendar feed from the database
      const feed = await prisma.calendarFeed.findFirst({
        where: {
          url: calendarPath,
          accountId: this.account.id,
          type: "CALDAV",
          userId,
        },
      });

      if (!feed) {
        throw new Error(`Calendar feed not found for path: ${calendarPath}`);
      }

      // Sync the calendar to get the newly created event
      const syncResult = await this.syncCalendar(feed.id, calendarPath, userId, {
        forceFullSync: true,
      });

      // Find the newly created event in the sync results
      const createdEvent = syncResult.added.find(
        (e) => e.externalEventId === eventId
      );

      if (!createdEvent) {
        throw new Error("Newly created event not found in sync results");
      }

      return createdEvent;
    } catch (error) {
      logger.error(
        "Failed to create CalDAV event",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          calendarPath,
          eventTitle: event.title,
        },
        LOG_SOURCE
      );
      throw error;
    }
  }

  /**
   * Define time range for events (1 year back to 1 year ahead)
   * @returns Object with start and end dates
   */
  private getTimeRange(): { start: Date; end: Date } {
    const now = newDate();
    return {
      start: newDateFromYMD(now.getFullYear() - 1, 0, 1), // 1 year ago, January 1st
      end: newDateFromYMD(now.getFullYear() + 1, 11, 31), // End of next year
    };
  }

  private async createAllEvents(
    events: CalendarEvent[],
    feedId: string,
    db: SyncDb
  ): Promise<SyncResult> {
    // Separate master events and instances
    const masterEvents = events.filter((e) => e.isMaster);
    const instanceEvents = events.filter((e) => !e.isMaster);

    // Create master events first
    const createdMasterEvents = await this.createMasterEvents(
      masterEvents,
      feedId,
      db
    );

    // Create a map of external IDs to database IDs for linking instances
    const masterEventMap = new Map<string, string>();
    // Slots the master rows already occupy under the (feed, external id, start)
    // key. An instance landing on one of these would upsert the master row into
    // an instance of itself, so those are dropped before the write.
    const masterEventSlots = new Set<string>();
    for (const event of createdMasterEvents) {
      if (event.externalEventId) {
        masterEventMap.set(event.externalEventId, event.id);
        masterEventSlots.add(
          `${event.externalEventId}|${event.start.getTime()}`
        );
      }
    }

    // Create instance events with proper links to master events
    const createdInstanceEvents = await this.createInstanceEvents(
      instanceEvents.filter(
        (e) =>
          !e.externalEventId ||
          !masterEventSlots.has(`${e.externalEventId}|${e.start.getTime()}`)
      ),
      masterEventMap,
      feedId,
      db
    );

    return {
      added: [...createdMasterEvents, ...createdInstanceEvents],
      updated: [],
      deleted: [],
    };
  }

  /**
   * Writes one synced event, keyed on the (feedId, externalEventId, start) unique
   * constraint, so a re-sync converges onto the existing row instead of inserting a
   * second one. Events with no external id have no stable identity to match on and
   * are inserted — which mirrors the database, where a NULL externalEventId is
   * deliberately left unconstrained.
   */
  private async persistSyncedEvent(
    eventData: Prisma.CalendarEventUncheckedCreateInput,
    db: SyncDb
  ): Promise<CalendarEvent> {
    const { feedId, externalEventId, start } = eventData;

    if (!externalEventId) {
      return db.calendarEvent.create({ data: eventData });
    }

    return db.calendarEvent.upsert({
      where: {
        feedId_externalEventId_start: { feedId, externalEventId, start },
      },
      create: eventData,
      // The where clause already pins feedId/externalEventId/start, so re-writing
      // them is a no-op; everything else is refreshed from the server's copy.
      update: eventData,
    });
  }

  private async createMasterEvents(
    masterEvents: CalendarEvent[],
    feedId: string,
    db: SyncDb
  ): Promise<CalendarEvent[]> {
    const createdEvents: CalendarEvent[] = [];

    // Process events in batches to avoid potential issues with large datasets
    for (const event of masterEvents) {
      // Prepare event data for database
      const eventData = {
        feedId,
        externalEventId: event.externalEventId,
        title: event.title || "Untitled Event",
        description: event.description,
        start: event.start,
        end: event.end,
        location: event.location,
        isRecurring: event.isRecurring || false,
        recurrenceRule: event.recurrenceRule,
        allDay: event.allDay || false,
        status: event.status,
        transparency: event.transparency ?? "OPAQUE",
        isMaster: true,
        masterEventId: null,
        recurringEventId: null,
        // Use Prisma.JsonNull for JSON fields
        organizer: Prisma.JsonNull,
        attendees: Prisma.JsonNull,
      };

      // Create the event
      const createdEvent = await this.persistSyncedEvent(eventData, db);

      createdEvents.push(createdEvent);
    }

    return createdEvents;
  }

  private async createInstanceEvents(
    instanceEvents: CalendarEvent[],
    masterEventMap: Map<string, string>,
    feedId: string,
    db: SyncDb
  ): Promise<CalendarEvent[]> {
    const createdEvents: CalendarEvent[] = [];

    // Process events in batches to avoid potential issues with large datasets
    for (const event of instanceEvents) {
      // Find the master event ID for this instance
      let masterEventId = null;
      if (
        event.recurringEventId &&
        masterEventMap.has(event.recurringEventId)
      ) {
        masterEventId = masterEventMap.get(event.recurringEventId) || null;
      }

      // Prepare event data for database
      const eventData = {
        feedId,
        externalEventId: event.externalEventId,
        title: event.title || "Untitled Event",
        description: event.description,
        start: event.start,
        end: event.end,
        location: event.location,
        isRecurring: event.isRecurring || false, // Instance events are not recurring themselves
        recurrenceRule: event.recurrenceRule, // Instance events don't have recurrence rules
        allDay: event.allDay || false,
        status: event.status,
        transparency: event.transparency ?? "OPAQUE",
        isMaster: false,
        masterEventId,
        recurringEventId: event.recurringEventId,
        // Use Prisma.JsonNull for JSON fields
        organizer: Prisma.JsonNull,
        attendees: Prisma.JsonNull,
      };

      // Create the event
      const createdEvent = await this.persistSyncedEvent(eventData, db);

      createdEvents.push(createdEvent);
    }

    return createdEvents;
  }

  /**
   * Extract key properties from a VEVENT component
   * @param vevent VEVENT component
   * @returns Object with extracted properties
   */
  private extractEventProperties(vevent: ICAL.Component): {
    uid: string;
    hasRRule: boolean;
    hasRecurrenceId: boolean;
    summary: string | null;
  } {
    const hasRRule = vevent.hasProperty("rrule");
    const hasRecurrenceId = vevent.hasProperty("recurrence-id");
    const uidValue = vevent.getFirstPropertyValue("uid");
    const uid = uidValue ? String(uidValue) : crypto.randomUUID();
    const summary = vevent.getFirstPropertyValue("summary");

    return {
      uid,
      hasRRule,
      hasRecurrenceId,
      summary: summary ? String(summary) : null,
    };
  }

  /**
   * Set event properties based on its type (master, instance, or standalone)
   * @param event The event to update
   * @param uid The event's UID
   * @param hasRRule Whether the event has a recurrence rule
   * @param hasRecurrenceId Whether the event has a recurrence ID
   * @param processedUids Set of already processed UIDs
   */
  private setEventTypeProperties(
    event: CalendarEvent,
    uid: string,
    hasRRule: boolean,
    hasRecurrenceId: boolean,
    processedUids: Set<string>
  ): void {
    // Set event properties based on its type
    if (hasRRule && !hasRecurrenceId) {
      // Master event
      event.isMaster = true;
      event.isRecurring = true;
      event.masterEventId = null;
      event.externalEventId = uid;
      processedUids.add(uid);
    } else if (hasRecurrenceId) {
      // Instance event
      event.isMaster = false;
      event.isRecurring = false;
      // For instance events, we need to link to the master event
      // The master event's UID is the base part of the instance's UID (before any _date suffix)
      const masterUid = uid.split("_")[0];
      event.masterEventId = masterUid;
      // For instance events, we append the date to make the ID unique
      const instanceDate = event.start.toISOString().split("T")[0];
      event.externalEventId = `${masterUid}_${instanceDate}`;
      processedUids.add(event.externalEventId);
    } else {
      // Standalone event
      event.isMaster = false;
      event.isRecurring = false;
      event.masterEventId = null;
      event.externalEventId = uid;
      processedUids.add(uid);
    }
  }
}
