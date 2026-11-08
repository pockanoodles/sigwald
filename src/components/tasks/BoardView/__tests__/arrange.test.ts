import { arrangeBoard } from "@/components/tasks/BoardView/arrange";

import { type Task, TaskStatus } from "@/types/task";

const NOW = new Date("2026-11-08T18:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const task = (id: string, extra: Partial<Task> = {}): Task =>
  ({ id, title: id, status: TaskStatus.TODO, tags: [], ...extra }) as Task;

describe("arrangeBoard", () => {
  it("orders open work by deadline, undated last, then by title", () => {
    const [todo] = arrangeBoard(
      [
        task("b-undated"),
        task("later", { dueDate: day(3) }),
        task("a-undated"),
        task("soon", { dueDate: day(1) }),
        task("overdue", { dueDate: day(-2) }),
      ],
      NOW
    );
    expect(todo.tasks.map((t) => t.id)).toEqual([
      "overdue",
      "soon",
      "later",
      "a-undated",
      "b-undated",
    ]);
    expect(todo.shown).toBe(5);
  });

  it("puts finished work newest first and folds what's older than a week", () => {
    const done = (id: string, at?: Date) =>
      task(id, { status: TaskStatus.COMPLETED, completedAt: at });
    const columns = arrangeBoard(
      [
        done("old", day(-30)),
        done("today", day(0)),
        done("legacy"),
        done("week", day(-6)),
      ],
      NOW
    );
    const completed = columns.find((c) => c.status === TaskStatus.COMPLETED)!;
    expect(completed.tasks.map((t) => t.id)).toEqual([
      "today",
      "week",
      "old",
      "legacy",
    ]);
    expect(completed.shown).toBe(2);
  });

  it("gives every status a column, empty or not", () => {
    expect(arrangeBoard([], NOW).map((c) => c.status)).toEqual([
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.COMPLETED,
    ]);
  });
});
