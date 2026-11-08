"use client";

import { useMemo, useState } from "react";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { newDate } from "@/lib/date-utils";

import { Task, TaskStatus } from "@/types/task";

import { TaskListToolbar } from "../TaskListToolbar";
import type { TaskPatch } from "../datasheet/columns";
import { useVisibleTasks } from "../filters/use-visible-tasks";
import { CardFace } from "./BoardCard";
import { Column } from "./Column";
import { BOARD_STATUSES, arrangeBoard } from "./arrange";

/** The board's columns are the statuses, so its filters leave Status to them. */
const BOARD_OMITS = ["status"] as const;

interface BoardViewProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onInlineEdit: (task: TaskPatch) => void;
}

/**
 * The tasks as a board, one column per status. It runs the sheet's pipeline
 * (lenses, filters, text, list mode) but orders each column for moving work:
 * open work by deadline, finished work newest first. Dragging a card to a
 * column sets its status; clicking it opens it. The card follows the pointer
 * in an overlay, so it isn't clipped by its column as it leaves.
 */
export function BoardView({
  tasks,
  onEdit,
  onStatusChange,
  onInlineEdit,
}: BoardViewProps) {
  const view = useVisibleTasks(tasks, BOARD_OMITS);
  const [dragging, setDragging] = useState<Task | null>(null);

  // A press only becomes a drag once it moves (or, on a phone, holds), so a
  // click opens the card and a swipe scrolls the column.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const columns = useMemo(
    () => arrangeBoard(view.visible, newDate()),
    [view.visible]
  );

  const onDragStart = ({ active }: DragStartEvent) =>
    setDragging(view.visible.find((t) => t.id === active.id) ?? null);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const status = over?.id as TaskStatus | undefined;
    const task = view.visible.find((t) => t.id === active.id);
    if (
      task &&
      status &&
      BOARD_STATUSES.includes(status) &&
      status !== task.status
    ) {
      onStatusChange(task.id, status);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <TaskListToolbar view={view} surface="board" />
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto p-2 md:snap-none md:gap-3 md:p-3">
          {columns.map(({ status, tasks: list, shown }) => (
            <Column
              key={status}
              status={status}
              tasks={list}
              shown={shown}
              onOpen={onEdit}
              onStatusChange={onStatusChange}
              onPatch={onInlineEdit}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <CardFace
              task={dragging}
              className="w-72 cursor-grabbing border-foreground/40 shadow-lg"
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
