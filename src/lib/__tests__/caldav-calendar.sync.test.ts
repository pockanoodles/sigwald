import { ConnectedAccount } from "@prisma/client";

import { CalDAVCalendarService } from "@/lib/caldav-calendar";
import { queryEvents } from "@/lib/caldav/client";
import { prisma } from "@/lib/prisma";

/**
 * A CalDAV sync fetches first and only then replaces the feed's events, in one
 * transaction. A failed fetch must leave the stored events, ctag and lastSync
 * alone, and record the error on the feed.
 */

jest.mock("@/lib/caldav/client", () => ({
  connectionFromAccount: jest.fn(() => ({})),
  queryEvents: jest.fn(),
  getCalendarCtag: jest.fn(),
  deleteObject: jest.fn(),
  getObjectText: jest.fn(),
  putObject: jest.fn(),
  resolveObjectUrl: jest.fn(),
}));

jest.mock("@/lib/prisma", () => {
  const tx = {
    calendarEvent: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    calendarFeed: { update: jest.fn() },
  };
  return {
    prisma: {
      calendarFeed: { findFirst: jest.fn(), updateMany: jest.fn() },
      calendarEvent: tx.calendarEvent,
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock("@/lib/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const account = {
  id: "acct-1",
  email: "user@example.com",
  caldavUsername: "user@example.com",
  accessToken: "token",
  caldavUrl: "https://dav.example.com",
} as unknown as ConnectedAccount;

const VEVENT = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:evt-1@example.com",
  "SUMMARY:Standup",
  "DTSTART:20990601T140000Z",
  "DTEND:20990601T143000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const tx = db.__tx;

beforeEach(() => {
  jest.clearAllMocks();
  db.calendarFeed.updateMany.mockResolvedValue({ count: 1 });
  db.calendarFeed.findFirst.mockResolvedValue({
    id: "feed-1",
    url: "/cal/",
    ctag: "old-ctag",
    syncToken: null,
  });
  tx.calendarEvent.upsert.mockImplementation(
    async ({ create }: { create: Record<string, unknown> }) => ({
      id: "row-1",
      ...create,
    })
  );
});

describe("CalDAVCalendarService.syncCalendar", () => {
  it("leaves existing events and the ctag alone when the fetch fails", async () => {
    (queryEvents as jest.Mock).mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      new CalDAVCalendarService(account).syncCalendar("feed-1", "/cal/", "u1", {
        forceFullSync: true,
      })
    ).rejects.toThrow("401 Unauthorized");

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.calendarEvent.deleteMany).not.toHaveBeenCalled();
    expect(tx.calendarFeed.update).not.toHaveBeenCalled();
    expect(db.calendarFeed.updateMany).toHaveBeenCalledWith({
      where: { id: "feed-1", userId: "u1" },
      data: { error: "401 Unauthorized" },
    });
  });

  it("replaces the feed's events and advances sync state after a good fetch", async () => {
    (queryEvents as jest.Mock).mockResolvedValue([
      { href: "/cal/evt-1.ics", props: { "calendar-data": VEVENT } },
    ]);

    const result = await new CalDAVCalendarService(account).syncCalendar(
      "feed-1",
      "/cal/",
      "u1",
      { forceFullSync: true }
    );

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.calendarEvent.deleteMany).toHaveBeenCalledWith({
      where: { feedId: "feed-1" },
    });
    expect(tx.calendarEvent.upsert).toHaveBeenCalledTimes(1);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].title).toBe("Standup");
    expect(tx.calendarFeed.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feed-1", userId: "u1" },
        data: expect.objectContaining({ error: null }),
      })
    );
    expect(db.calendarFeed.updateMany).not.toHaveBeenCalled();
  });
});
