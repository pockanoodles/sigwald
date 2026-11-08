"use client";

/**
 * Courses on the Tasks page (its Tasks lens, components/tasks/lens.ts): the
 * sheet's Mat column, read off the `materialCount` fact Courses adds to its
 * tasks, the course code on a phone row and a board card (the `courseLabel`
 * fact), and the Course and Submission filters (task-filters.ts). They leave
 * the page while Courses is off.
 */
import { useMemo } from "react";

import { EMPTY, type TaskColumn } from "@/components/tasks/datasheet/columns";
import type { TasksLens } from "@/components/tasks/lens";

import { cn } from "@/lib/utils";

import {
  COURSE_FILTER,
  SUBMISSION_FILTER,
} from "@/modules/courses/task-filters";

import { useModuleOn } from "@/store/modules";

import type { Task } from "@/types/task";

function materialsText(task: Task): string {
  const count = task.materialCount;
  if (!count) return "";
  const noun = count.total === 1 ? "material" : "materials";
  return count.cited
    ? `${count.total} ${noun} · ${count.cited} cited in the instructions`
    : `${count.total} ${noun} from the same module`;
}

export const MATERIALS_COLUMN: TaskColumn = {
  id: "materials",
  label: "Mat",
  sortKey: "materials",
  width: 56,
  align: "right",
  after: "dueDate",
  // Cited materials are the instructor saying "read this", so a count with
  // any cited gets the accent; a module-only count stays quiet.
  render: (t) => {
    const count = t.materialCount;
    if (!count) return EMPTY;
    return (
      <span
        className={cn(
          "tabular-nums",
          count.cited ? "text-rust-text" : "text-muted-foreground"
        )}
      >
        {count.total}
      </span>
    );
  },
  text: materialsText,
  editor: { kind: "readonly" },
  formValue: materialsText,
  sortValue: (t) => t.materialCount?.total || null,
};

export function useCoursesTasksLens(): TasksLens | null {
  const on = useModuleOn("courses");
  return useMemo(
    () =>
      on === true
        ? {
            columns: [MATERIALS_COLUMN],
            filters: [COURSE_FILTER, SUBMISSION_FILTER],
            rowLabel: (task: Task) => task.courseLabel ?? null,
          }
        : null,
    [on]
  );
}
