import {
  parentMatchesListFilters,
  taskMatchesListFilters,
} from "@/components/tasks/filters/match";
import {
  groupTasksByParent,
  groupTasksForListMode,
  isDeferredTask,
  isUpcomingTask,
  parseTaskListMode,
  taskMatchesListMode,
} from "@/components/tasks/utils/task-list-utils";

import { addDays, newDate, startOfDay } from "@/lib/date-utils";

import { Task, TaskStatus } from "@/types/task";

// Minimal Task factory: only the fields the list filter inspects matter; the
// rest are filled with inert defaults so the object satisfies the Task type.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Test task",
    status: TaskStatus.TODO,
    tags: [],
    createdAt: newDate(),
    updatedAt: newDate(),
    isRecurring: false,
    isAutoScheduled: false,
    scheduleLocked: false,
    ...overrides,
  };
}

describe("isUpcomingTask", () => {
  it("returns true when startDate is on a later calendar day", () => {
    const tomorrow = addDays(startOfDay(newDate()), 1);
    expect(isUpcomingTask(makeTask({ startDate: tomorrow }))).toBe(true);
  });

  it("returns false when startDate is later today (same calendar day)", () => {
    // 23:59 today is after `now` as an instant but is NOT a future day, so the
    // task should NOT be treated as upcoming (matches the "Upcoming" badge).
    const laterToday = addDays(startOfDay(newDate()), 1);
    laterToday.setMilliseconds(laterToday.getMilliseconds() - 1); // last ms of today
    expect(isUpcomingTask(makeTask({ startDate: laterToday }))).toBe(false);
  });

  it("returns false when startDate is the start of today", () => {
    expect(isUpcomingTask(makeTask({ startDate: startOfDay(newDate()) }))).toBe(
      false
    );
  });

  it("returns false when startDate is on a previous calendar day", () => {
    const yesterday = addDays(startOfDay(newDate()), -1);
    expect(isUpcomingTask(makeTask({ startDate: yesterday }))).toBe(false);
  });

  it("returns false when there is no startDate", () => {
    expect(isUpcomingTask(makeTask({ startDate: null }))).toBe(false);
    expect(isUpcomingTask(makeTask({ startDate: undefined }))).toBe(false);
  });
});

describe('taskMatchesListFilters - Start is not "Starts later"', () => {
  const tomorrow = addDays(startOfDay(newDate()), 1);
  const laterToday = (() => {
    const d = addDays(startOfDay(newDate()), 1);
    d.setMilliseconds(d.getMilliseconds() - 1);
    return d;
  })();

  const hideLater = {
    conditions: { startDate: { values: ["later"], exclude: true } },
  };

  it("hides a future-day task", () => {
    expect(
      taskMatchesListFilters(makeTask({ startDate: tomorrow }), hideLater)
    ).toBe(false);
  });

  it("keeps a later-today task", () => {
    expect(
      taskMatchesListFilters(makeTask({ startDate: laterToday }), hideLater)
    ).toBe(true);
  });

  it("keeps a task with no startDate", () => {
    expect(
      taskMatchesListFilters(makeTask({ startDate: null }), hideLater)
    ).toBe(true);
  });

  it("keeps a future-day task with no Start condition", () => {
    expect(taskMatchesListFilters(makeTask({ startDate: tomorrow }), {})).toBe(
      true
    );
  });
});

describe("isDeferredTask", () => {
  it("returns true when postponedUntil is in the future", () => {
    const later = addDays(newDate(), 1);
    expect(isDeferredTask(makeTask({ postponedUntil: later }))).toBe(true);
  });

  it("returns false when postponedUntil is in the past", () => {
    const earlier = addDays(newDate(), -1);
    expect(isDeferredTask(makeTask({ postponedUntil: earlier }))).toBe(false);
  });

  it("returns false when there is no postponedUntil", () => {
    expect(isDeferredTask(makeTask({ postponedUntil: null }))).toBe(false);
    expect(isDeferredTask(makeTask({ postponedUntil: undefined }))).toBe(false);
  });

  it("never hides a task due before its deferral ends", () => {
    // Later on Canvas work due at 11:59 PM tonight, put off to the end of the day.
    const now = new Date("2026-11-08T18:00:00Z");
    const task = makeTask({
      source: "CANVAS",
      dueDate: new Date("2026-11-09T04:59:00Z"),
      postponedUntil: new Date("2026-11-09T04:59:59Z"),
    });
    expect(isDeferredTask(task, now, "America/New_York")).toBe(false);
  });

  it("reads a date-only due as the end of its day", () => {
    const now = new Date("2026-11-08T18:00:00Z");
    // Picked as Nov 9 with no time (UTC midnight), deferred to the end of Nov 8.
    const dueTomorrow = makeTask({
      dueDate: new Date("2026-11-09T00:00:00Z"),
      postponedUntil: new Date("2026-11-09T04:59:59Z"),
    });
    expect(isDeferredTask(dueTomorrow, now, "America/New_York")).toBe(true);
  });
});

describe("taskMatchesListFilters - deferred", () => {
  const later = addDays(newDate(), 1);

  it("hides deferred tasks by default", () => {
    expect(
      taskMatchesListFilters(makeTask({ postponedUntil: later }), {})
    ).toBe(false);
  });

  it("shows deferred tasks when showDeferred is on", () => {
    expect(
      taskMatchesListFilters(makeTask({ postponedUntil: later }), {
        showDeferred: true,
      })
    ).toBe(true);
  });

  it("shows deferred tasks when searching", () => {
    expect(
      taskMatchesListFilters(
        makeTask({ title: "Buy milk", postponedUntil: later }),
        { search: "milk" }
      )
    ).toBe(true);
  });
});

describe("taskMatchesListFilters - other predicates are preserved", () => {
  it("filters by status", () => {
    const task = makeTask({ status: TaskStatus.COMPLETED });
    const status = (values: string[]) => ({
      conditions: { status: { values } },
    });
    expect(taskMatchesListFilters(task, status([TaskStatus.TODO]))).toBe(false);
    expect(taskMatchesListFilters(task, status([TaskStatus.COMPLETED]))).toBe(
      true
    );
  });

  it("filters by search across title", () => {
    const task = makeTask({ title: "Buy groceries" });
    expect(taskMatchesListFilters(task, { search: "groc" })).toBe(true);
    expect(taskMatchesListFilters(task, { search: "xyz" })).toBe(false);
  });

  it("matches everything when no filters are provided", () => {
    expect(taskMatchesListFilters(makeTask(), {})).toBe(true);
  });
});

describe("groupTasksByParent", () => {
  it("nests children under their parent and sorts by order", () => {
    const parent = makeTask({ id: "p" });
    const second = makeTask({
      id: "c2",
      parentTaskId: "p",
      order: 2,
      title: "Second",
    });
    const first = makeTask({
      id: "c1",
      parentTaskId: "p",
      order: 1,
      title: "First",
    });
    const other = makeTask({ id: "p2", title: "Other" });

    const { parents, childrenOf } = groupTasksByParent([
      second,
      parent,
      other,
      first,
    ]);

    expect(parents.map((t) => t.id)).toEqual(["p", "p2"]);
    expect(childrenOf.p.map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(childrenOf.p2).toBeUndefined();
  });

  it("does not treat children as parents", () => {
    const child = makeTask({ id: "c", parentTaskId: "missing" });
    const { parents, childrenOf } = groupTasksByParent([child]);
    expect(parents).toEqual([]);
    expect(childrenOf.missing.map((t) => t.id)).toEqual(["c"]);
  });
});

describe("parentMatchesListFilters", () => {
  it("shows a parent when a child title matches search", () => {
    const parent = makeTask({ id: "p", title: "Essay" });
    const child = makeTask({
      id: "c",
      parentTaskId: "p",
      title: "Outline intro",
    });
    expect(
      parentMatchesListFilters(parent, [child], { search: "outline" })
    ).toBe(true);
  });

  it("hides a parent when neither parent nor child matches search", () => {
    const parent = makeTask({ id: "p", title: "Essay" });
    const child = makeTask({
      id: "c",
      parentTaskId: "p",
      title: "Outline intro",
    });
    expect(parentMatchesListFilters(parent, [child], { search: "xyz" })).toBe(
      false
    );
  });
});

describe("taskMatchesListMode", () => {
  // Monday 21 Sep 2026 15:00 local. Due stamps are UTC midnight of the
  // calendar day, matching how TaskRow writes dueDate.
  const now = new Date(2026, 8, 21, 15, 0, 0);
  const utcDay = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day));

  it("All keeps every task", () => {
    expect(taskMatchesListMode(makeTask({ dueDate: null }), "all", now)).toBe(
      true
    );
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 21) }),
        "all",
        now
      )
    ).toBe(true);
  });

  it("Today is overdue plus due today", () => {
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 20) }),
        "today",
        now
      )
    ).toBe(true);
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 21) }),
        "today",
        now
      )
    ).toBe(true);
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 22) }),
        "today",
        now
      )
    ).toBe(false);
    expect(taskMatchesListMode(makeTask({ dueDate: null }), "today", now)).toBe(
      false
    );
  });

  it("Today keeps a deadline late tonight, as the Due column reads it", () => {
    // Canvas's 11:59 PM is a real moment. West of UTC it's tomorrow's UTC
    // date, which the old UTC-day reading put in Upcoming.
    const tonight = new Date(2026, 8, 21, 23, 59);
    expect(
      taskMatchesListMode(makeTask({ dueDate: tonight }), "today", now)
    ).toBe(true);
    expect(
      taskMatchesListMode(makeTask({ dueDate: tonight }), "upcoming", now)
    ).toBe(false);
  });

  it("Upcoming is tomorrow through today plus 7 days", () => {
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 21) }),
        "upcoming",
        now
      )
    ).toBe(false);
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 22) }),
        "upcoming",
        now
      )
    ).toBe(true);
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 28) }),
        "upcoming",
        now
      )
    ).toBe(true);
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 29) }),
        "upcoming",
        now
      )
    ).toBe(false);
  });

  it("Someday is undated only", () => {
    expect(
      taskMatchesListMode(makeTask({ dueDate: null }), "someday", now)
    ).toBe(true);
    expect(
      taskMatchesListMode(
        makeTask({ dueDate: utcDay(2026, 9, 21) }),
        "someday",
        now
      )
    ).toBe(false);
  });
});

describe("groupTasksForListMode", () => {
  const now = new Date(2026, 8, 21, 15, 0, 0);
  const utcDay = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day));

  it("splits Today into Overdue then Today", () => {
    const overdue = makeTask({ id: "o", dueDate: utcDay(2026, 9, 20) });
    const today = makeTask({ id: "t", dueDate: utcDay(2026, 9, 21) });
    const groups = groupTasksForListMode([today, overdue], "today", now);
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today"]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["o"]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["t"]);
  });

  it("groups Upcoming by day and skips empty days", () => {
    const tue = makeTask({ id: "tue", dueDate: utcDay(2026, 9, 22) });
    const sun = makeTask({ id: "sun", dueDate: utcDay(2026, 9, 27) });
    const groups = groupTasksForListMode([sun, tue], "upcoming", now);
    expect(groups).toHaveLength(2);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["tue"]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["sun"]);
    expect(groups[0].label).toBe("Tomorrow");
  });
});

describe("parseTaskListMode", () => {
  it("accepts the four modes and rejects anything else", () => {
    expect(parseTaskListMode("today")).toBe("today");
    expect(parseTaskListMode("upcoming")).toBe("upcoming");
    expect(parseTaskListMode("someday")).toBe("someday");
    expect(parseTaskListMode("all")).toBe("all");
    expect(parseTaskListMode("focus")).toBeNull();
    expect(parseTaskListMode(null)).toBeNull();
  });
});
