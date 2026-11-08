/**
 * How the board lays tasks out: one column per status, open work by deadline
 * (soonest first, undated last, then title) and finished work newest first.
 * Completed shows its last week; the rest fold under "earlier". Pure.
 */
import { Task, TaskStatus } from "@/types/task";

/** How far back Completed reaches before folding the rest under "earlier". */
export const RECENT_DONE_DAYS = 7;

export const BOARD_STATUSES = Object.values(TaskStatus);

export interface BoardColumn {
  status: TaskStatus;
  tasks: Task[];
  /** How many of `tasks`, from the top, show before "earlier". */
  shown: number;
}

const time = (d: Date | string | null | undefined) =>
  d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;

const byDeadline = (a: Task, b: Task) =>
  time(a.dueDate) - time(b.dueDate) || a.title.localeCompare(b.title);

// Undated (legacy) completions sort last, as the oldest.
const finished = (t: Task) => (t.completedAt ? time(t.completedAt) : -Infinity);
const byFinished = (a: Task, b: Task) => finished(b) - finished(a);

export function arrangeBoard(tasks: readonly Task[], now: Date): BoardColumn[] {
  const since = now.getTime() - RECENT_DONE_DAYS * 86_400_000;
  return BOARD_STATUSES.map((status) => {
    const done = status === TaskStatus.COMPLETED;
    const list = tasks
      .filter((t) => t.status === status)
      .sort(done ? byFinished : byDeadline);
    return {
      status,
      tasks: list,
      shown: done
        ? list.filter((t) => finished(t) >= since).length
        : list.length,
    };
  });
}
