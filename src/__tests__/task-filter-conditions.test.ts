import {
  NO_VALUE,
  TASK_FILTER_FIELDS,
} from "@/components/tasks/filters/fields";
import {
  countDeferred,
  countOptions,
  describeCondition,
  optionsWithPicked,
  parentMatchesListFilters,
  sameConditions,
  taskMatchesListFilters,
} from "@/components/tasks/filters/match";
import { withLensFilterFields } from "@/components/tasks/lens";
import { dueBucket } from "@/components/tasks/utils/task-list-utils";

import { addDays, newDate } from "@/lib/date-utils";

import {
  COURSE_FILTER,
  SUBMISSION_FILTER,
} from "@/modules/courses/task-filters";

import {
  DEFAULT_CONDITIONS,
  migrateTaskListViewSettings,
} from "@/store/taskListViewSettings";

import { Priority, Task, TaskStatus } from "@/types/task";

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

const field = (id: string) => {
  const found = [...TASK_FILTER_FIELDS, COURSE_FILTER, SUBMISSION_FILTER].find(
    (f) => f.id === id
  );
  if (!found) throw new Error(`no field ${id}`);
  return found;
};

const withCourses = [...TASK_FILTER_FIELDS, COURSE_FILTER, SUBMISSION_FILTER];

describe("conditions", () => {
  it("'is' keeps a task with any picked value", () => {
    const task = makeTask({ priority: Priority.HIGH });
    const priority = (values: string[]) => ({
      conditions: { priority: { values } },
    });
    expect(taskMatchesListFilters(task, priority(["high", "low"]))).toBe(true);
    expect(taskMatchesListFilters(task, priority(["low"]))).toBe(false);
  });

  it("'is not' drops a task with any picked value", () => {
    const task = makeTask({ priority: Priority.HIGH });
    const notPriority = (values: string[]) => ({
      conditions: { priority: { values, exclude: true } },
    });
    expect(taskMatchesListFilters(task, notPriority(["high"]))).toBe(false);
    expect(taskMatchesListFilters(task, notPriority(["low"]))).toBe(true);
  });

  it("an 'is not' with nothing picked narrows nothing", () => {
    expect(
      taskMatchesListFilters(makeTask(), {
        conditions: { priority: { values: [], exclude: true } },
      })
    ).toBe(true);
  });

  it("reads null and 'none' priority as the same None", () => {
    const none = { conditions: { priority: { values: [NO_VALUE] } } };
    expect(taskMatchesListFilters(makeTask({ priority: null }), none)).toBe(
      true
    );
    expect(
      taskMatchesListFilters(makeTask({ priority: Priority.NONE }), none)
    ).toBe(true);
    expect(
      taskMatchesListFilters(makeTask({ priority: Priority.LOW }), none)
    ).toBe(false);
  });

  it("matches a tag condition on any of the task's tags", () => {
    const task = makeTask({
      tags: [
        { id: "a", name: "Read" },
        { id: "b", name: "Write" },
      ],
    });
    expect(
      taskMatchesListFilters(task, { conditions: { tags: { values: ["b"] } } })
    ).toBe(true);
    expect(
      taskMatchesListFilters(task, {
        conditions: { tags: { values: ["b"], exclude: true } },
      })
    ).toBe(false);
    expect(
      taskMatchesListFilters(makeTask(), {
        conditions: { tags: { values: [NO_VALUE] } },
      })
    ).toBe(true);
  });

  it("ignores a condition whose field isn't on (its module is off)", () => {
    const task = makeTask({ courseLabel: "SCHM2301" });
    const course = { course: { values: ["CS3500"] } };
    expect(taskMatchesListFilters(task, { conditions: course })).toBe(true);
    expect(
      taskMatchesListFilters(task, { conditions: course, fields: withCourses })
    ).toBe(false);
  });

  it("skips one field's condition when asked", () => {
    const task = makeTask({ status: TaskStatus.COMPLETED });
    const filters = { conditions: DEFAULT_CONDITIONS };
    expect(taskMatchesListFilters(task, filters)).toBe(false);
    expect(taskMatchesListFilters(task, filters, "status")).toBe(true);
  });

  it("still surfaces a parent through a child's title under a skip", () => {
    const parent = makeTask({ id: "p", status: TaskStatus.COMPLETED });
    const child = makeTask({ id: "c", parentTaskId: "p", title: "Outline" });
    expect(
      parentMatchesListFilters(parent, [child], {
        conditions: DEFAULT_CONDITIONS,
        search: "outl",
      })
    ).toBe(true);
  });
});

describe("dueBucket", () => {
  const now = new Date(2026, 8, 21, 15, 0, 0);
  const utcDay = (month: number, day: number) =>
    new Date(Date.UTC(2026, month - 1, day));

  it("splits due dates into overdue, today, next 7 days and later", () => {
    expect(dueBucket(makeTask({ dueDate: utcDay(9, 20) }), now)).toBe(
      "overdue"
    );
    expect(dueBucket(makeTask({ dueDate: utcDay(9, 21) }), now)).toBe("today");
    expect(dueBucket(makeTask({ dueDate: utcDay(9, 22) }), now)).toBe("week");
    expect(dueBucket(makeTask({ dueDate: utcDay(9, 28) }), now)).toBe("week");
    expect(dueBucket(makeTask({ dueDate: utcDay(9, 29) }), now)).toBe("later");
    expect(dueBucket(makeTask({ dueDate: null }), now)).toBeNull();
  });
});

describe("countOptions", () => {
  const tasks = [
    makeTask({ id: "a", status: TaskStatus.TODO, priority: Priority.HIGH }),
    makeTask({ id: "b", status: TaskStatus.TODO, priority: Priority.LOW }),
    makeTask({
      id: "c",
      status: TaskStatus.COMPLETED,
      priority: Priority.HIGH,
    }),
  ];
  const scope = (conditions = {}) => ({
    parents: tasks,
    childrenOf: {},
    filters: { conditions },
    mode: "all" as const,
  });

  it("counts a field's values with every other filter applied", () => {
    const counts = countOptions(
      field("priority"),
      scope({ status: { values: [TaskStatus.TODO] } })
    );
    expect(counts.get("high")).toBe(1);
    expect(counts.get("low")).toBe(1);
  });

  it("ignores the field's own condition, so every value keeps its count", () => {
    const counts = countOptions(
      field("status"),
      scope({ status: { values: [TaskStatus.TODO] } })
    );
    expect(counts.get(TaskStatus.TODO)).toBe(2);
    expect(counts.get(TaskStatus.COMPLETED)).toBe(1);
  });

  it("counts deferred rows the other filters let through", () => {
    const later = addDays(newDate(), 1);
    const deferred = [
      makeTask({ id: "d1", postponedUntil: later }),
      makeTask({
        id: "d2",
        postponedUntil: later,
        status: TaskStatus.COMPLETED,
      }),
    ];
    expect(
      countDeferred({
        parents: deferred,
        childrenOf: {},
        filters: { conditions: DEFAULT_CONDITIONS },
        mode: "all",
      })
    ).toBe(1);
  });
});

describe("the menu's helpers", () => {
  it("keeps a picked value the tasks no longer carry", () => {
    const options = optionsWithPicked([{ value: "a", label: "A" }], {
      values: ["a", "gone"],
    });
    expect(options.map((o) => o.value)).toEqual(["a", "gone"]);
  });

  it("describes a condition in the options' order", () => {
    const status = field("status");
    expect(
      describeCondition(
        status,
        { values: [TaskStatus.IN_PROGRESS, TaskStatus.TODO] },
        status.options([])
      )
    ).toBe("Status is Todo, In Progress");
    expect(
      describeCondition(
        status,
        { values: [TaskStatus.COMPLETED], exclude: true },
        status.options([])
      )
    ).toBe("Status is not Completed");
  });

  it("compares conditions regardless of order and empty picks", () => {
    expect(
      sameConditions(
        { status: { values: ["in_progress", "todo"] }, tags: { values: [] } },
        DEFAULT_CONDITIONS
      )
    ).toBe(true);
    expect(
      sameConditions(
        { status: { values: ["todo", "in_progress"], exclude: true } },
        DEFAULT_CONDITIONS
      )
    ).toBe(false);
  });
});

describe("Courses' fields", () => {
  const tasks = [
    makeTask({
      courseLabel: "SCHM2301",
      courseName: "Supply Chain",
      submissionStatus: "graded",
    }),
    makeTask({ courseLabel: "CS3500", submissionStatus: "missing" }),
    makeTask({ courseLabel: "CS3500", submissionStatus: "unsubmitted" }),
    makeTask(),
  ];

  it("offers each course once, by code, then the tasks with none", () => {
    expect(COURSE_FILTER.options(tasks)).toEqual([
      { value: "CS3500", label: "CS3500", title: undefined },
      { value: "SCHM2301", label: "SCHM2301", title: "Supply Chain" },
      { value: NO_VALUE, label: "Not a course" },
    ]);
  });

  it("offers the submission states present, in the order work moves", () => {
    expect(SUBMISSION_FILTER.options(tasks).map((o) => o.value)).toEqual([
      "unsubmitted",
      "missing",
      "graded",
      NO_VALUE,
    ]);
  });

  it("slots in after Due", () => {
    const ids = withLensFilterFields(TASK_FILTER_FIELDS, [
      { filters: [COURSE_FILTER, SUBMISSION_FILTER] },
    ]).map((f) => f.id);
    expect(ids.slice(0, 4)).toEqual([
      "status",
      "dueDate",
      "course",
      "submission",
    ]);
  });
});

describe("migrateTaskListViewSettings to conditions", () => {
  it("carries the old filters over as conditions", () => {
    const state = migrateTaskListViewSettings(
      {
        status: ["todo"],
        energyLevel: ["high"],
        timePreference: ["morning"],
        tagIds: ["t"],
        hideUpcomingTasks: true,
      },
      3
    );
    expect(state.conditions).toEqual({
      status: { values: ["todo"] },
      energyLevel: { values: ["high"] },
      preferredTime: { values: ["morning"] },
      tags: { values: ["t"] },
      startDate: { values: ["later"], exclude: true },
    });
    expect(state).not.toHaveProperty("status");
    expect(state).not.toHaveProperty("hideUpcomingTasks");
  });

  it("reads a missing status as cleared, not the default", () => {
    expect(migrateTaskListViewSettings({ search: "x" }, 3).conditions).toEqual(
      {}
    );
  });

  it("leaves a current blob alone", () => {
    const conditions = { dueDate: { values: ["overdue"] } };
    expect(migrateTaskListViewSettings({ conditions }, 4).conditions).toBe(
      conditions
    );
  });
});

describe("migrateTaskListViewSettings to an unsaved text filter", () => {
  it("drops a saved search term, which nothing on screen would show", () => {
    const state = migrateTaskListViewSettings(
      { search: "netflix", conditions: {} },
      4
    );
    expect(state.search).toBeUndefined();
  });
});
