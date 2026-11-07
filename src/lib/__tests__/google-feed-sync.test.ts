import type { calendar_v3 } from "googleapis";

import { getGoogleCalendarClient } from "@/lib/google-calendar";
import {
  eventRowId,
  processRecurrenceRule,
  syncGoogleFeed,
  syncWindow,
  writeFeedEvents,
} from "@/lib/google-feed-sync";
import { prisma } from "@/lib/prisma";

/**
 * A Google sync reads Google first and only then replaces the feed's events,
 * in one transaction. A failed read must leave the stored events and lastSync
 * alone and record the error on the feed.
 */

jest.mock("@/lib/google-calendar", () => ({ getGoogleCalendarClient: jest.fn() }));

jest.mock("@/lib/prisma", () => {
  let n = 0;
  const tx = {
    calendarEvent: {
      deleteMany: jest.fn(),
      create: jest.fn(async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? `row-${++n}` })),
    },
    calendarFeed: { update: jest.fn() },
  };
  return {
    prisma: {
      calendarFeed: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
      calendarEvent: tx.calendarEvent,
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock("@/lib/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

type Tx = {
  calendarEvent: { deleteMany: jest.Mock; create: jest.Mock };
  calendarFeed: { update: jest.Mock };
};
const db = prisma as unknown as {
  calendarFeed: { findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
  __tx: Tx;
};
const tx = db.__tx;

const feed = {
  id: "feed-1",
  type: "GOOGLE",
  accountId: "acct-1",
  url: "me@example.com",
  userId: "user-1",
};

const single: calendar_v3.Schema$Event = {
  id: "evt-1",
  summary: "Dentist",
  start: { dateTime: "2026-11-10T14:00:00Z" },
  end: { dateTime: "2026-11-10T15:00:00Z" },
};
const instance: calendar_v3.Schema$Event = {
  id: "series-1_20261111T140000Z",
  recurringEventId: "series-1",
  summary: "Standup",
  start: { dateTime: "2026-11-11T14:00:00Z" },
  end: { dateTime: "2026-11-11T14:15:00Z" },
};
const master: calendar_v3.Schema$Event = {
  id: "series-1",
  summary: "Standup",
  recurrence: ["RRULE:FREQ=DAILY"],
  start: { dateTime: "2026-11-01T14:00:00Z" },
  end: { dateTime: "2026-11-01T14:15:00Z" },
};

function client(opts: { list?: jest.Mock; get?: jest.Mock }) {
  return {
    events: {
      list: opts.list ?? jest.fn(async () => ({ data: { items: [single, instance] } })),
      get: opts.get ?? jest.fn(async () => ({ data: master })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.calendarFeed.findUnique.mockResolvedValue(feed);
});

describe("syncGoogleFeed", () => {
  it("replaces the events and marks the feed synced in one transaction", async () => {
    (getGoogleCalendarClient as jest.Mock).mockResolvedValue(client({}));

    const result = await syncGoogleFeed("feed-1");

    expect(result.events).toBe(3);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.calendarEvent.deleteMany).toHaveBeenCalledWith({ where: { feedId: "feed-1" } });
    expect(tx.calendarFeed.update).toHaveBeenCalledWith({
      where: { id: "feed-1" },
      data: { lastSync: expect.any(Date), error: null },
    });
  });

  it("keeps the stored events and records the error when Google fails", async () => {
    const list = jest.fn(async () => {
      throw new Error("invalid_grant");
    });
    (getGoogleCalendarClient as jest.Mock).mockResolvedValue(client({ list }));

    await expect(syncGoogleFeed("feed-1")).rejects.toThrow("invalid_grant");

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.calendarEvent.deleteMany).not.toHaveBeenCalled();
    expect(db.calendarFeed.update).toHaveBeenCalledWith({
      where: { id: "feed-1" },
      data: { error: "invalid_grant" },
    });
  });

  it("reads every page", async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce({ data: { items: [single], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { items: [instance] } });
    (getGoogleCalendarClient as jest.Mock).mockResolvedValue(client({ list }));

    await syncGoogleFeed("feed-1");

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0]).toMatchObject({ pageToken: "p2", singleEvents: true });
  });

  it("refuses a feed that isn't a connected Google calendar", async () => {
    db.calendarFeed.findUnique.mockResolvedValue({ ...feed, type: "CALDAV" });
    await expect(syncGoogleFeed("feed-1")).rejects.toThrow(/not a connected Google calendar/);
    expect(getGoogleCalendarClient).not.toHaveBeenCalled();
  });
});

describe("writeFeedEvents", () => {
  it("links instances to their master row, and both carry the rule", async () => {
    await writeFeedEvents(
      tx as never,
      "feed-1",
      [single, instance, { id: "no-start" }],
      new Map([["series-1", master]])
    );

    const rows = tx.calendarEvent.create.mock.calls.map((c) => c[0].data);
    expect(rows).toHaveLength(3); // the startless event is skipped
    const [m, s, i] = rows;
    expect(m).toMatchObject({
      externalEventId: "series-1",
      isMaster: true,
      recurrenceRule: "RRULE:FREQ=DAILY",
    });
    expect(s).toMatchObject({ externalEventId: "evt-1", isRecurring: false, masterEventId: undefined });
    expect(i).toMatchObject({
      externalEventId: "series-1_20261111T140000Z",
      isMaster: false,
      isRecurring: true,
      recurrenceRule: "RRULE:FREQ=DAILY",
      masterEventId: m.id,
    });
  });

  it("gives an event the same row id on every sync, per feed", async () => {
    await writeFeedEvents(tx as never, "feed-1", [single], new Map());
    await writeFeedEvents(tx as never, "feed-1", [single], new Map());
    await writeFeedEvents(tx as never, "feed-2", [single], new Map());
    const ids = tx.calendarEvent.create.mock.calls.map((c) => c[0].data.id);
    expect(ids[0]).toBe(eventRowId("feed-1", "evt-1"));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("still writes an instance whose master couldn't be read", async () => {
    await writeFeedEvents(tx as never, "feed-1", [instance], new Map());
    const [row] = tx.calendarEvent.create.mock.calls.map((c) => c[0].data);
    expect(row).toMatchObject({ isRecurring: true, masterEventId: undefined });
  });

  it("stores an all-day event as all-day", async () => {
    await writeFeedEvents(
      tx as never,
      "feed-1",
      [{ id: "hol", summary: "Culture Day", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } }],
      new Map()
    );
    expect(tx.calendarEvent.create.mock.calls[0][0].data.allDay).toBe(true);
  });
});

describe("processRecurrenceRule", () => {
  it("adds the start's month and day to a bare yearly rule", () => {
    expect(processRecurrenceRule(["RRULE:FREQ=YEARLY"], new Date(2026, 10, 3))).toBe(
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3"
    );
  });

  it("ignores EXDATE lines and returns undefined without a rule", () => {
    expect(processRecurrenceRule(["EXDATE:20261103T140000Z", "RRULE:FREQ=WEEKLY"])).toBe(
      "RRULE:FREQ=WEEKLY"
    );
    expect(processRecurrenceRule(["EXDATE:20261103T140000Z"])).toBeUndefined();
    expect(processRecurrenceRule(undefined)).toBeUndefined();
  });
});

describe("syncWindow", () => {
  it("reaches a year ahead, so December already sees next January", () => {
    const { timeMin, timeMax } = syncWindow(new Date(2026, 11, 15));
    expect(new Date(timeMin).getFullYear()).toBe(2026);
    expect(new Date(timeMax) > new Date(2027, 0, 31)).toBe(true);
  });
});
