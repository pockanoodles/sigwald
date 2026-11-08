"use client";

import { type HTMLAttributes, forwardRef } from "react";

import { useDraggable } from "@dnd-kit/core";

import { format, newDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

import { Task, TaskStatus } from "@/types/task";

import type { TaskPatch } from "../datasheet/columns";
import { useTasksLenses } from "../use-tasks-lenses";
import { formatContextualDate } from "../utils/task-list-utils";

interface BoardCardProps {
  task: Task;
  onOpen: (task: Task) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onPatch: (task: TaskPatch) => void;
}

/**
 * A task on the board: the done box, the title, then one quiet line of what
 * matters for moving it (when it's due, how long it takes, what a module
 * says about it). Click opens it, drag moves it between statuses. Its
 * controls are always there: nothing appears on hover.
 *
 * Its body comes from the sheet's columns and the modules' lenses, not a
 * vocabulary of its own: the notes, energy and time of day live in the
 * sheet and the task's dialog.
 */
export function BoardCard({
  task,
  onOpen,
  onStatusChange,
  onPatch,
}: BoardCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });
  return (
    <CardFace
      ref={setNodeRef}
      task={task}
      onStatusChange={onStatusChange}
      onPatch={onPatch}
      {...attributes}
      {...listeners}
      // dnd-kit makes the card a button for keyboard dragging; Enter opens it.
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(task);
        else listeners?.onKeyDown?.(e);
      }}
      // The card stays in its column while its copy travels in the overlay.
      className={cn(isDragging && "opacity-40")}
    />
  );
}

type CardFaceProps = {
  task: Task;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
  onPatch?: (task: TaskPatch) => void;
} & HTMLAttributes<HTMLDivElement>;

/** The card itself, shared by the board and the copy that follows a drag. */
export const CardFace = forwardRef<HTMLDivElement, CardFaceProps>(
  function CardFace(
    { task, onStatusChange, onPatch, className, ...rest },
    ref
  ) {
    const lenses = useTasksLenses();
    const done = task.status === TaskStatus.COMPLETED;
    const due = task.dueDate
      ? formatContextualDate(newDate(task.dueDate))
      : null;
    // A module with a control on the card shows its value through it (Ladder:
    // the goal picker); one without shows its row label (Courses: the course).
    const labels = lenses.flatMap((lens) =>
      lens.Control ? [] : (lens.rowLabel?.(task) ?? [])
    );
    const scheduled =
      !done && task.isAutoScheduled && task.scheduledStart
        ? format(newDate(task.scheduledStart), "EEE p")
        : null;

    return (
      <div
        ref={ref}
        className={cn(
          "flex cursor-pointer items-start gap-2 border border-border bg-card px-2.5 py-2 transition-colors duration-150 hover:border-foreground/30 focus-visible:border-foreground focus-visible:outline-none",
          className
        )}
        {...rest}
      >
        <input
          type="checkbox"
          checked={done}
          disabled={!onStatusChange}
          onChange={() =>
            onStatusChange?.(
              task.id,
              done ? TaskStatus.TODO : TaskStatus.COMPLETED
            )
          }
          // Ticking it is neither a click on the card nor the start of a drag.
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={done ? "Mark as todo" : "Mark as completed"}
          className="mt-0.5 h-3.5 w-3.5 flex-none cursor-pointer border-border bg-transparent text-foreground focus:ring-0 focus:ring-offset-0"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "line-clamp-2 text-[13px] font-medium leading-snug",
              done
                ? "text-muted-foreground line-through decoration-1"
                : "text-foreground"
            )}
          >
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            {done ? (
              // Done work isn't late: say when it was finished instead.
              task.completedAt ? (
                <span>Done {format(newDate(task.completedAt), "MMM d")}</span>
              ) : null
            ) : due ? (
              <span className={cn(due.isOverdue && "text-destructive")}>
                {due.text}
              </span>
            ) : null}
            {task.duration ? <span>{task.duration}m</span> : null}
            {scheduled ? (
              <span title="On the calendar">{scheduled}</span>
            ) : null}
            {labels.map((label) => (
              <span key={label} className="truncate">
                {label}
              </span>
            ))}
            {task.tags.map((tag) => (
              <span key={tag.id} style={{ color: tag.color || undefined }}>
                #{tag.name}
              </span>
            ))}
            {/* What the modules add (Ladder: the goal chip), editable in
                place. The wrapper keeps it from opening or dragging the card. */}
            {onPatch && lenses.some((lens) => lens.Control) ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {lenses.map((lens, i) =>
                  lens.Control ? (
                    <lens.Control
                      key={i}
                      task={task}
                      onPatch={onPatch}
                      variant="card"
                    />
                  ) : null
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);
