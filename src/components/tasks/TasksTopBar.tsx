"use client";

import { BsKanban, BsTable } from "react-icons/bs";
import { HiOutlinePlus } from "react-icons/hi";

import {
  BarButton,
  type BarSegment,
  BarSegmented,
} from "@/components/navigation/top-bar-parts";

import { useIsMobile } from "@/hooks/use-media-query";

import { useTaskStore } from "@/store/task";
import { useTaskModalStore } from "@/store/taskModal";
import {
  type TaskViewMode,
  useTaskPageSettings,
} from "@/store/taskPageSettings";

import { useTasksLenses } from "./use-tasks-lenses";

/** The tasks page's share of the app top bar — see CalendarTopBar for why
 *  these live with their feature rather than inside AppTopBar. */

const VIEW_SEGMENTS: ReadonlyArray<BarSegment<TaskViewMode>> = [
  { id: "sheet", label: "Sheet", icon: BsTable },
  { id: "board", label: "Board", icon: BsKanban },
];

export function TasksTopBarViews() {
  const { viewMode, setViewMode } = useTaskPageSettings();
  return (
    <BarSegmented
      label="Task view"
      segments={VIEW_SEGMENTS}
      value={viewMode}
      onChange={setViewMode}
    />
  );
}

export function TasksTopBarActions() {
  const scheduleAllTasks = useTaskStore((s) => s.scheduleAllTasks);
  // Creating from a module's view links the task there (Ladder: the open goal tab).
  const newTaskGoalId = useTasksLenses().find(
    (lens) => lens.newTaskGoalId
  )?.newTaskGoalId;
  const openCreate = useTaskModalStore((s) => s.openCreate);
  const isMobile = useIsMobile();

  return (
    <>
      {/* A bulk re-slot of every task is a desk action, and at 393px these two
          buttons squeezed the page title and the List/Board switch off the bar
          entirely. Still reachable from ⌘K. */}
      {!isMobile && (
        <BarButton onClick={() => scheduleAllTasks()}>Auto Schedule</BarButton>
      )}
      <BarButton
        emphasis="loud"
        icon={HiOutlinePlus}
        data-create-task-button=""
        onClick={() => openCreate(newTaskGoalId)}
      >
        Create Task
      </BarButton>
    </>
  );
}
