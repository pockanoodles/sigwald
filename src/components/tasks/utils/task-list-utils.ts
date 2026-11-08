import {
  addDays,
  format,
  isFutureDate,
  isThisWeek,
  isThisYear,
  isToday,
  isTomorrow,
  newDate,
  startOfDay,
  taskDay,
} from "@/lib/date-utils";
import { dueBy } from "@/lib/sigwald/due";
import { deferralHides } from "@/lib/sigwald/rank-stage1";

import {
  EnergyLevel,
  Priority,
  Task,
  TaskListMode,
  TaskStatus,
  TimePreference,
} from "@/types/task";

/**
 * A task is "upcoming" when it has a start date that falls on a later calendar
 * day than today. This is the single source of truth shared by the Start
 * filter's "Starts later" and the sheet's row tint, so the two can never
 * disagree about which tasks are upcoming. Uses day-granularity (`isFutureDate`)
 * rather than an instant comparison, so a task starting later today is not
 * treated as upcoming.
 */
export const isUpcomingTask = (task: Pick<Task, "startDate">): boolean => {
  return Boolean(task.startDate) && isFutureDate(task.startDate ?? null);
};

/**
 * A task is deferred when `postponedUntil` is still in the future and it
 * isn't due before then. Instant comparison, not day-granularity: a defer "in
 * 3 hours" and a calendar-day defer both hide until that moment. A task due
 * before its deferral ends is never hidden (rank-stage1 `deferralHides`):
 * Later on tonight's assignment must not take it off the sheet. `startDate`
 * is the scheduler's earliest-work field (Outlook/Google sync) and is not a
 * hide signal — TaskRow Defer writes `postponedUntil`.
 */
export const isDeferredTask = (
  task: Pick<Task, "postponedUntil" | "dueDate" | "source">,
  now: Date = newDate(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): boolean => {
  if (!task.postponedUntil) return false;
  return deferralHides(
    {
      postponedUntil: newDate(task.postponedUntil),
      // The moment it's due by: a date picked without a time runs to the end of that day.
      dueDate: task.dueDate
        ? dueBy(newDate(task.dueDate), task.source, timeZone)
        : null,
    },
    now
  );
};

/**
 * Short label for a defer stamp: "Later today", "Tomorrow", or the same
 * contextual date the due column uses.
 */
export const formatDeferLabel = (value: Date | string): string => {
  const d = newDate(value);
  if (isToday(d)) return "Later today";
  if (isTomorrow(d)) return "Tomorrow";
  return formatContextualDate(d).text;
};

/**
 * Split a flat task list into top-level parents and children keyed by parent.
 * Children sort by `order`, then createdAt. Orphan children (parent missing
 * from the list) are dropped so they cannot render as top-level rows.
 */
export const groupTasksByParent = (
  tasks: Task[]
): { parents: Task[]; childrenOf: Record<string, Task[]> } => {
  const childrenOf: Record<string, Task[]> = {};
  const parents: Task[] = [];
  for (const task of tasks) {
    if (task.parentTaskId) {
      const list = childrenOf[task.parentTaskId] ?? [];
      list.push(task);
      childrenOf[task.parentTaskId] = list;
    } else {
      parents.push(task);
    }
  }
  for (const list of Object.values(childrenOf)) {
    list.sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return newDate(a.createdAt).getTime() - newDate(b.createdAt).getTime();
    });
  }
  return { parents, childrenOf };
};

/**
 * Query modes on `/tasks`. These slice the inventory by due date. They are
 * not Focus — no ranking, no suggested lane. A due date reads as the day the
 * Due column shows (`dueDateAsLocalDay`).
 */
export type { TaskListMode } from "@/types/task";

export const TASK_LIST_MODES: readonly TaskListMode[] = [
  "all",
  "today",
  "upcoming",
  "someday",
];

export function parseTaskListMode(value: string | null): TaskListMode | null {
  if (value && (TASK_LIST_MODES as readonly string[]).includes(value)) {
    return value as TaskListMode;
  }
  return null;
}

/**
 * Local midnight of the day a task is due, read the way the Due column reads
 * it (`taskDay`): a date picked without a time names its UTC calendar day,
 * and a deadline with a time is due on the day it falls in here. Rebuilding
 * every stamp from its UTC day put a Canvas 11:59 PM deadline on the next
 * day, so Today missed it while the column said "Today".
 */
export const dueDateAsLocalDay = (due: Date | string): Date =>
  taskDay(newDate(due));

/** Where a due date falls from today. */
export type DueBucket = "overdue" | "today" | "week" | "later";

/**
 * Where a task's due date falls: overdue, today, the next seven days, or
 * later; null when it has none. The Due filter's values and what the list
 * modes slice by (Today is overdue plus today, Upcoming the next seven days,
 * Someday undated), so the two can't disagree.
 */
export const dueBucket = (
  task: Pick<Task, "dueDate">,
  now: Date = newDate()
): DueBucket | null => {
  if (!task.dueDate) return null;
  const today = startOfDay(now).getTime();
  const due = dueDateAsLocalDay(task.dueDate).getTime();
  if (due < today) return "overdue";
  if (due === today) return "today";
  return due <= addDays(startOfDay(now), 7).getTime() ? "week" : "later";
};

/**
 * Whether a parent row belongs in the current list mode. Completed status
 * is a separate filter. Subtasks are grouped under their parent, not sliced
 * here.
 */
export const taskMatchesListMode = (
  task: Pick<Task, "dueDate">,
  mode: TaskListMode,
  now: Date = newDate()
): boolean => {
  if (mode === "all") return true;
  const bucket = dueBucket(task, now);
  if (mode === "someday") return bucket === null;
  if (mode === "today") return bucket === "overdue" || bucket === "today";
  return bucket === "week";
};

export interface TaskListGroup {
  key: string;
  label: string | null;
  tasks: Task[];
}

/**
 * Band the already-filtered/sorted parents. Today splits Overdue / Today.
 * Upcoming is one band per day for the next 7 days (empty days omitted).
 * All and Someday stay a single unlabeled list.
 */
export const groupTasksForListMode = (
  tasks: Task[],
  mode: TaskListMode,
  now: Date = newDate()
): TaskListGroup[] => {
  if (mode === "today") {
    const today = startOfDay(now);
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const due = dueDateAsLocalDay(task.dueDate);
      if (due.getTime() < today.getTime()) overdue.push(task);
      else dueToday.push(task);
    }
    const groups: TaskListGroup[] = [];
    if (overdue.length > 0) {
      groups.push({ key: "overdue", label: "Overdue", tasks: overdue });
    }
    if (dueToday.length > 0) {
      groups.push({ key: "today", label: "Today", tasks: dueToday });
    }
    return groups;
  }

  if (mode === "upcoming") {
    const today = startOfDay(now);
    const groups: TaskListGroup[] = [];
    for (let offset = 1; offset <= 7; offset += 1) {
      const day = addDays(today, offset);
      const dayTasks = tasks.filter((task) => {
        if (!task.dueDate) return false;
        return dueDateAsLocalDay(task.dueDate).getTime() === day.getTime();
      });
      if (dayTasks.length === 0) continue;
      groups.push({
        key: format(day, "yyyy-MM-dd"),
        label: offset === 1 ? "Tomorrow" : format(day, "EEEE"),
        tasks: dayTasks,
      });
    }
    return groups;
  }

  return [{ key: mode, label: null, tasks }];
};

export const emptyListModeMessage = (mode: TaskListMode): string => {
  if (mode === "today") return "Nothing due today.";
  if (mode === "upcoming") return "Nothing due in the next 7 days.";
  if (mode === "someday") return "No undated tasks.";
  return "No tasks match.";
};

// Helper function to format enum values for display
export const formatEnumValue = (value: string) => {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export const statusColors = {
  [TaskStatus.TODO]: "bg-muted text-muted-foreground",
  [TaskStatus.IN_PROGRESS]: "bg-rust/10 text-rust-text",
  [TaskStatus.COMPLETED]: "bg-ok/10 text-ok",
};

export const energyLevelColors = {
  high: "bg-muted text-muted-foreground",
  medium: "bg-muted text-muted-foreground",
  low: "bg-muted text-muted-foreground",
};

export const timePreferenceColors = {
  [TimePreference.MORNING]: "bg-muted text-muted-foreground",
  [TimePreference.AFTERNOON]: "bg-muted text-muted-foreground",
  [TimePreference.EVENING]: "bg-muted text-muted-foreground",
};

export const priorityColors = {
  [Priority.HIGH]: "bg-rust/10 text-rust-text",
  [Priority.MEDIUM]: "bg-warning/10 text-warning",
  [Priority.LOW]: "bg-muted text-muted-foreground",
  [Priority.NONE]: "bg-muted text-muted-foreground",
};

// Semantic rank for the Priority column so the Tasks list sorts by meaning
// (low < medium < high) instead of alphabetically by the enum label.
// Priority.NONE is intentionally omitted: the app represents "no priority" as
// BOTH null (an untouched modal) and the literal "none" (explicit select), so
// both must bucket last together rather than "none" sorting among real values.
// An omitted key makes rankOf return undefined, which compareRanks sorts last.
export const PRIORITY_SORT_RANK: Partial<Record<Priority, number>> = {
  [Priority.LOW]: 1,
  [Priority.MEDIUM]: 2,
  [Priority.HIGH]: 3,
};

// Semantic rank for the Energy column (low < medium < high).
export const ENERGY_LEVEL_SORT_RANK: Partial<Record<EnergyLevel, number>> = {
  [EnergyLevel.LOW]: 1,
  [EnergyLevel.MEDIUM]: 2,
  [EnergyLevel.HIGH]: 3,
};

// Look up a value's rank in a rank map, returning undefined for missing values
// AND for any value not present in the map. The DB stores priority/energyLevel
// as plain strings, so a stale or externally-imported value (e.g. "urgent")
// can reach the comparator; we treat such unknown values like a missing value
// rather than producing NaN.
const rankOf = (
  value: string | null | undefined,
  ranks: Partial<Record<string, number>>
): number | undefined => {
  if (value == null) return undefined;
  // Use an own-property check so prototype keys ("toString", "__proto__", ...)
  // don't resolve to an inherited property; an unknown string is treated like a
  // missing one. hasOwnProperty.call avoids depending on Object.hasOwn at
  // runtime and on the value owning its own hasOwnProperty.
  return Object.prototype.hasOwnProperty.call(ranks, value)
    ? ranks[value]
    : undefined;
};

// Compare two rank lookups so missing/unknown values always sort last,
// regardless of direction (matching the other nullable columns), and two
// missing/unknown values compare equal (stable). `direction` is 1 (asc) or -1
// (desc).
const compareRanks = (
  rankA: number | undefined,
  rankB: number | undefined,
  direction: number
): number => {
  if (rankA === undefined && rankB === undefined) return 0;
  if (rankA === undefined) return 1;
  if (rankB === undefined) return -1;
  return direction * (rankA - rankB);
};

// Comparator for sorting tasks by priority rank. `direction` is 1 (asc) or -1
// (desc), matching how the Tasks list applies its sort direction. Tasks with no
// priority (or an unrecognized value) always sort last, regardless of
// direction, like the other nullable columns.
export const compareTaskPriority = (
  a: Pick<Task, "priority">,
  b: Pick<Task, "priority">,
  direction: number
): number =>
  compareRanks(
    rankOf(a.priority, PRIORITY_SORT_RANK),
    rankOf(b.priority, PRIORITY_SORT_RANK),
    direction
  );

// Comparator for sorting tasks by energy-level rank. Same direction and
// missing/unknown-last semantics as compareTaskPriority.
export const compareTaskEnergyLevel = (
  a: Pick<Task, "energyLevel">,
  b: Pick<Task, "energyLevel">,
  direction: number
): number =>
  compareRanks(
    rankOf(a.energyLevel, ENERGY_LEVEL_SORT_RANK),
    rankOf(b.energyLevel, ENERGY_LEVEL_SORT_RANK),
    direction
  );

/**
 * A task date as a column-width label: "Today", "Tomorrow", "Friday",
 * "Mar 10", "Overdue: Aug 31".
 *
 * A date picked without a time is stored at UTC midnight, so reading it in
 * local time lands on 8:00 PM the day before (or noon, depending on the zone).
 * A deadline with a time (Canvas's 11:59 PM, a module's end of day) is a real
 * moment, and its UTC date can be the next day. `taskDay` reads each the
 * right way. There were three copies of this — two pasted into cell
 * components and this exported one; the copies now import this.
 */
export const formatContextualDate = (date: Date) => {
  const localDate = taskDay(date);
  const now = newDate();
  now.setHours(0, 0, 0, 0);

  const isOverdue = localDate < now && !isToday(localDate);
  const isFuture = isFutureDate(localDate);

  let text: string;
  if (isToday(localDate)) {
    text = "Today";
  } else if (isTomorrow(localDate)) {
    text = "Tomorrow";
  } else if (isThisWeek(localDate)) {
    text = format(localDate, "EEEE");
  } else if (isThisYear(localDate)) {
    text = format(localDate, "MMM d");
  } else {
    text = format(localDate, "MMM d, yyyy");
  }
  if (isOverdue) {
    text = `Overdue: ${text}`;
  }

  return { text, isOverdue, isFuture };
};
