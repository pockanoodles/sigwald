"use client";

import { useState } from "react";

import { useDroppable } from "@dnd-kit/core";

import { cn } from "@/lib/utils";

import { Task, TaskStatus } from "@/types/task";

import type { TaskPatch } from "../datasheet/columns";
import { formatEnumValue } from "../utils/task-list-utils";
import { BoardCard } from "./BoardCard";

interface ColumnProps {
  status: TaskStatus;
  /** In board order (BoardView). */
  tasks: Task[];
  /**
   * How many of `tasks`, from the top, show before "earlier": Completed
   * keeps to the last week, or the column would grow with every task ever
   * finished.
   */
  shown?: number;
  onOpen: (task: Task) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onPatch: (task: TaskPatch) => void;
}

const DOT: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: "bg-muted-foreground",
  [TaskStatus.IN_PROGRESS]: "bg-rust",
  [TaskStatus.COMPLETED]: "bg-ok",
};

const EMPTY: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: "Nothing to do.",
  [TaskStatus.IN_PROGRESS]: "Drag a task here when you start it.",
  [TaskStatus.COMPLETED]: "Nothing finished this week.",
};

export function Column({
  status,
  tasks,
  shown = tasks.length,
  onOpen,
  onStatusChange,
  onPatch,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [all, setAll] = useState(false);
  const visible = all ? tasks : tasks.slice(0, shown);
  const earlier = tasks.length - shown;

  return (
    <section
      ref={setNodeRef}
      aria-label={formatEnumValue(status)}
      className={cn(
        "flex w-[84vw] max-w-xs flex-none snap-center flex-col border bg-background transition-colors duration-150 md:w-auto md:min-w-64 md:max-w-none md:flex-1",
        isOver ? "border-rust" : "border-border"
      )}
    >
      <header className="flex h-9 flex-none items-center gap-2 border-b border-border px-3">
        <span className={cn("h-1.5 w-1.5 flex-none", DOT[status])} />
        <h2 className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
          {formatEnumValue(status)}
        </h2>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
        {visible.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            onPatch={onPatch}
          />
        ))}
        {visible.length === 0 && earlier <= 0 ? (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            {EMPTY[status]}
          </p>
        ) : null}
        {earlier > 0 ? (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="er-slash w-full px-1.5 py-2 text-left font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            {all ? "Last week only" : `${earlier} earlier`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
