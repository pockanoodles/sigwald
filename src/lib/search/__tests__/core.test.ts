import type { Db } from "@/lib/prisma";
import { searchEvents, searchTasks } from "@/lib/search/core";
import type { SearchQuery } from "@/lib/search/types";

const NY = "America/New_York";
// Sunday Nov 8 2026, 1 PM in New York.
const now = new Date("2026-11-08T18:00:00Z");
const q = (text: string): SearchQuery => ({
  text,
  now,
  timeZone: NY,
  timeFormat: "12h",
});

type Row = Record<string, unknown>;
const taskRow = (r: Row) => ({
  status: "todo",
  closedAt: null,
  dueDate: null,
  source: null,
  parentTaskId: null,
  parentTask: null,
  ...r,
});

function dbWith(
  tasks: Row[] = [],
  events: { upcoming?: Row[]; past?: Row[] } = {}
) {
  const taskFind = jest.fn().mockResolvedValue(tasks);
  const eventFind = jest
    .fn()
    .mockImplementation(({ where }: { where: { start: { gte?: Date } } }) =>
      Promise.resolve(
        where.start.gte ? (events.upcoming ?? []) : (events.past ?? [])
      )
    );
  const db = {
    task: { findMany: taskFind },
    calendarEvent: { findMany: eventFind },
  } as unknown as Db;
  return { db, taskFind, eventFind };
}

describe("searchTasks", () => {
  it("asks only for this person's tasks, without a module's that's off", async () => {
    const { db, taskFind } = dbWith();
    await searchTasks(db, "u1", q("netflix"), ["CANVAS"]);
    const { where } = taskFind.mock.calls[0][0];
    expect(where.userId).toBe("u1");
    expect(JSON.stringify(where)).toContain("CANVAS");
  });

  it("puts title matches over notes, and open work over done among them", async () => {
    const { db } = dbWith([
      taskRow({
        id: "notes",
        title: "Read chapter",
        description: "netflix case",
      }),
      taskRow({ id: "done", title: "Netflix memo", status: "completed" }),
      taskRow({ id: "word", title: "Assignment 8 (Netflix)" }),
      taskRow({ id: "start", title: "Netflix memo draft" }),
    ]);
    const group = await searchTasks(db, "u1", q("netflix"), []);
    expect(group.hits.map((h) => h.id)).toEqual([
      "start",
      "word",
      "done",
      "notes",
    ]);
    expect(group.hits[2].detail).toBe("Done");
  });

  it("opens a subtask's parent", async () => {
    const { db } = dbWith([
      taskRow({
        id: "child",
        title: "Outline",
        parentTaskId: "parent",
        parentTask: { title: "Essay" },
      }),
    ]);
    const [hit] = (await searchTasks(db, "u1", q("outline"), [])).hits;
    expect(hit.href).toBe("/tasks?task=parent");
    expect(hit.detail).toBe("In Essay");
  });

  it("counts a date-only due to the end of its day where the person is", async () => {
    const { db } = dbWith([
      // Picked as "Nov 8" with no time: stored at UTC midnight.
      taskRow({
        id: "a",
        title: "Timesheet",
        dueDate: new Date("2026-11-08T00:00:00Z"),
      }),
    ]);
    const [hit] = (await searchTasks(db, "u1", q("timesheet"), [])).hits;
    // Still due today at 1 PM in New York, not overdue since 7 PM yesterday.
    expect(hit.when).toBe("10h left");
  });
});

describe("searchEvents", () => {
  const event = (r: Row) => ({
    allDay: false,
    location: null,
    feed: { name: "NEU" },
    ...r,
  });

  it("skips series masters and shows a series once, at its next occurrence", async () => {
    const { db, eventFind } = dbWith([], {
      upcoming: [
        event({
          id: "e2",
          title: "MKTG lecture",
          start: new Date("2026-11-10T14:00:00Z"),
        }),
        event({
          id: "e3",
          title: "MKTG lecture",
          start: new Date("2026-11-12T14:00:00Z"),
        }),
      ],
      past: [
        event({
          id: "e1",
          title: "MKTG lecture",
          start: new Date("2026-11-05T14:00:00Z"),
        }),
      ],
    });
    const group = await searchEvents(db, "u1", q("mktg"));
    expect(eventFind.mock.calls[0][0].where.isMaster).toBe(false);
    expect(eventFind.mock.calls[0][0].where.feed).toEqual({
      userId: "u1",
      enabled: true,
    });
    expect(group.hits.map((h) => h.id)).toEqual(["e2"]);
    expect(group.hits[0].when).toBe("Tuesday 9:00 AM");
    expect(group.hits[0].href).toBe("/calendar?date=2026-11-10");
  });

  it("puts upcoming events ahead of past ones", async () => {
    const { db } = dbWith([], {
      upcoming: [
        event({
          id: "soon",
          title: "Career fair prep",
          start: new Date("2026-11-20T15:00:00Z"),
        }),
      ],
      past: [
        event({
          id: "gone",
          title: "Career fair",
          start: new Date("2026-11-01T15:00:00Z"),
        }),
      ],
    });
    const group = await searchEvents(db, "u1", q("career"));
    expect(group.hits.map((h) => h.id)).toEqual(["soon", "gone"]);
  });

  it("reads an all-day event's day as stored, in either zone", async () => {
    const { db } = dbWith([], {
      upcoming: [
        event({
          id: "utc",
          title: "Holiday A",
          allDay: true,
          start: new Date("2026-11-11T00:00:00Z"),
        }),
        event({
          id: "local",
          title: "Holiday B",
          allDay: true,
          start: new Date("2026-11-12T05:00:00Z"),
        }),
      ],
    });
    const group = await searchEvents(db, "u1", q("holiday"));
    expect(group.hits.map((h) => h.href)).toEqual([
      "/calendar?date=2026-11-11",
      "/calendar?date=2026-11-12",
    ]);
  });
});
