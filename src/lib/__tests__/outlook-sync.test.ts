import { eventRowId } from "@/lib/feed-replace";
import { getOutlookClient } from "@/lib/outlook-calendar";
import {
  outlookFeedRows,
  outlookSyncWindow,
  syncOutlookFeed,
} from "@/lib/outlook-sync";
import { prisma } from "@/lib/prisma";

/**
 * A full Outlook sync reads Graph completely (events, then every series'
 * instances) and only then replaces the feed's events in one locked
 * transaction. A failed read, including one series' instances, must leave the
 * stored events alone and record the error on the feed.
 */

jest.mock("@/lib/outlook-calendar", () => ({
  getOutlookClient: jest.fn(),
  convertOutlookRecurrenceToRRule: jest.fn(() => "RRULE:FREQ=WEEKLY"),
}));

jest.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: jest.fn(async () => 0),
    calendarEvent: { deleteMany: jest.fn(), createMany: jest.fn() },
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
  $executeRaw: jest.Mock;
  calendarEvent: { deleteMany: jest.Mock; createMany: jest.Mock };
  calendarFeed: { update: jest.Mock };
};
const db = prisma as unknown as {
  calendarFeed: { findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
  __tx: Tx;
};
const tx = db.__tx;

const at = (iso: string) => ({ dateTime: iso, timeZone: "UTC" });
const single = { id: "one-off", subject: "Dentist", start: at("2026-11-10T15:00:00"), end: at("2026-11-10T16:00:00") };
const master = {
  id: "series",
  subject: "Standup",
  start: at("2026-11-02T14:00:00"),
  end: at("2026-11-02T14:15:00"),
  recurrence: { pattern: { type: "weekly" } },
};
const instance = (n: number) => ({
  id: `series-${n}`,
  subject: "Standup",
  seriesMasterId: "series",
  start: at(`2026-11-0${n}T14:00:00`),
  end: at(`2026-11-0${n}T14:15:00`),
});

/** A Graph client double: the calendarView/delta list, then instances per series. */
function graph(opts: { instancesFail?: boolean } = {}) {
  const request = (path: string) => {
    const chain = {
      header: () => chain,
      query: () => chain,
      select: () => chain,
      orderby: () => chain,
      top: () => chain,
      get: async () => {
        if (path.includes("/instances")) {
          if (opts.instancesFail) throw new Error("429 Too Many Requests");
          return { value: [instance(2), instance(9)] };
        }
        return {
          // The series' own occurrences also come back in calendarView; they
          // are skipped there and written from the instances call instead.
          value: [single, master, instance(2)],
          "@odata.deltaLink": "https://graph/delta?deltatoken=tok-2",
        };
      },
    };
    return chain;
  };
  return { api: jest.fn(request) };
}

const feed = { id: "feed-1", type: "OUTLOOK", accountId: "acct-1", url: "cal-1", userId: "u1", syncToken: "tok-1" };

beforeEach(() => {
  jest.clearAllMocks();
  db.calendarFeed.findUnique.mockResolvedValue(feed);
});

describe("syncOutlookFeed", () => {
  it("replaces the events in one locked transaction after reading everything", async () => {
    (getOutlookClient as jest.Mock).mockResolvedValue(graph());

    const result = await syncOutlookFeed("feed-1");

    expect(result.events).toBe(4); // one-off, master, two instances
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.calendarEvent.deleteMany.mock.invocationCallOrder[0]
    );
    expect(tx.calendarEvent.deleteMany).toHaveBeenCalledWith({ where: { feedId: "feed-1" } });
    expect(tx.calendarFeed.update).toHaveBeenCalledWith({
      where: { id: "feed-1" },
      data: { lastSync: expect.any(Date), error: null, syncToken: "tok-2" },
    });
  });

  it("keeps the stored events when one series' instances fail to load", async () => {
    (getOutlookClient as jest.Mock).mockResolvedValue(graph({ instancesFail: true }));

    await expect(syncOutlookFeed("feed-1")).rejects.toThrow("429");

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.calendarEvent.deleteMany).not.toHaveBeenCalled();
    expect(db.calendarFeed.update).toHaveBeenCalledWith({
      where: { id: "feed-1" },
      data: { error: "429 Too Many Requests" },
    });
  });

  it("refuses a feed that isn't Outlook", async () => {
    db.calendarFeed.findUnique.mockResolvedValue({ ...feed, type: "GOOGLE" });
    await expect(syncOutlookFeed("feed-1")).rejects.toThrow("not a connected Outlook calendar");
  });
});

describe("outlookFeedRows", () => {
  const snapshot = {
    singles: [single],
    masters: [master],
    instances: new Map([["series", [instance(2), instance(9), instance(2)]]]),
  };

  it("gives every event a stable id and links instances to their master", () => {
    const rows = outlookFeedRows("feed-1", snapshot as never);
    const byExternal = new Map(rows.map((r) => [r.externalEventId, r]));

    expect(byExternal.get("one-off")?.id).toBe(eventRowId("feed-1", "one-off"));
    expect(byExternal.get("series")).toMatchObject({
      id: eventRowId("feed-1", "series"),
      isMaster: true,
      recurrenceRule: "RRULE:FREQ=WEEKLY",
    });
    expect(byExternal.get("series-9")).toMatchObject({
      masterEventId: eventRowId("feed-1", "series"),
      recurringEventId: "series",
      recurrenceRule: "RRULE:FREQ=WEEKLY",
      isMaster: false,
    });
  });

  it("writes an event Graph lists twice once", () => {
    const rows = outlookFeedRows("feed-1", snapshot as never);
    expect(rows.filter((r) => r.externalEventId === "series-2")).toHaveLength(1);
    expect(rows).toHaveLength(4);
  });

  it("gives the same ids on every run", () => {
    const a = outlookFeedRows("feed-1", snapshot as never).map((r) => r.id);
    const b = outlookFeedRows("feed-1", snapshot as never).map((r) => r.id);
    expect(a).toEqual(b);
  });
});

describe("outlookSyncWindow", () => {
  it("moves with the date it's given", () => {
    const w = outlookSyncWindow(new Date(2030, 5, 15));
    expect(w.timeMin.getFullYear()).toBe(2029);
    expect(w.timeMax.getFullYear()).toBe(2031);
    expect(w.timeMax.getMonth()).toBe(11);
  });
});
