"use client";

import { useMemo } from "react";

import { HiOutlineDocumentText, HiOutlineViewBoards } from "react-icons/hi";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { cn } from "@/lib/utils";

import { useIsMobile } from "@/hooks/use-media-query";

import { useTaskListViewSettings } from "@/store/taskListViewSettings";

import { TaskListModeSwitch } from "./TaskListModeSwitch";
import { TASK_COLUMNS } from "./datasheet/columns";
import { TaskFilterMenu } from "./filters/TaskFilterMenu";
import type { VisibleTasks } from "./filters/use-visible-tasks";
import { withLensColumns } from "./lens";
import { useTasksLenses } from "./use-tasks-lenses";

/** A strip control: one height and one voice for everything on the line. */
const CONTROL =
  "flex h-7 flex-none items-center gap-1.5 border border-border px-2 font-mono text-xs uppercase tracking-wide transition-colors duration-150";

/** A control's word. Below xl, with the rail open, the mode segments, Filter
 *  and the count leave too little room for both these words, so Columns and
 *  Packet keep only their icons there and name themselves on hover. */
const WORD = "hidden xl:inline";

/** Unavailable here, not gone: it keeps its place and reads as such. */
const UNAVAILABLE =
  "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:text-muted-foreground";

/**
 * The strip above the sheet and the board. Kept on the page rather than
 * promoted into the app top bar: the bar holds what's true everywhere, and a
 * filter is a property of this page.
 *
 * It's one line with the same controls in the same places in Sheet and
 * Board. A control that doesn't apply to the view you're on stays where it
 * is and reads as unavailable, so switching views never moves anything.
 * When it's narrow Columns and Packet drop their words; nothing wraps. What
 * keeps it to one line is the Filter button: every filter lives in its menu,
 * text included. There's no search box here: the top bar's search is the one
 * place to look for anything, and on this page it offers to filter by what
 * you typed.
 */
export function TaskListToolbar({
  view,
  surface,
}: {
  view: VisibleTasks;
  surface: "sheet" | "board";
}) {
  const isMobile = useIsMobile();
  const visibleColumns = useTaskListViewSettings((s) => s.visibleColumns);
  const toggleColumn = useTaskListViewSettings((s) => s.toggleColumn);
  const packetOpen = useTaskListViewSettings((s) => s.packetOpen);
  const setPacketOpen = useTaskListViewSettings((s) => s.setPacketOpen);
  const lenses = useTasksLenses();
  const columns = useMemo(
    () => withLensColumns(TASK_COLUMNS, lenses),
    [lenses]
  );

  const onSheet = surface === "sheet";
  const count = view.visible.length;

  return (
    <div className="flex h-11 flex-none items-center gap-2 border-b border-border px-2">
      <TaskListModeSwitch />
      <TaskFilterMenu view={view} />
      <span className="hidden flex-none px-1 font-mono text-xs tabular-nums text-muted-foreground sm:inline">
        {count} task{count === 1 ? "" : "s"}
      </span>

      <div className="ml-auto flex flex-none items-center gap-2">
        {/* A phone always shows rows, so these two are desk controls. */}
        {!isMobile && (
          <>
            {onSheet ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Columns"
                    title="Columns"
                    className={cn(
                      CONTROL,
                      "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <HiOutlineViewBoards className="h-3.5 w-3.5" />
                    <span className={WORD}>Columns</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {columns.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={
                        col.id === "title" || visibleColumns.includes(col.id)
                      }
                      disabled={col.id === "title"}
                      onCheckedChange={() => toggleColumn(col.id)}
                    >
                      {col.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                aria-disabled
                aria-label="Columns"
                title="Columns belong to the sheet"
                className={cn(CONTROL, "text-muted-foreground", UNAVAILABLE)}
              >
                <HiOutlineViewBoards className="h-3.5 w-3.5" />
                <span className={WORD}>Columns</span>
              </button>
            )}

            <button
              type="button"
              aria-pressed={onSheet && packetOpen}
              aria-disabled={!onSheet || undefined}
              onClick={() => onSheet && setPacketOpen(!packetOpen)}
              aria-label="Packet"
              title={
                onSheet
                  ? "Show the selected Canvas task's instructions, rubric and materials"
                  : "The packet opens beside the sheet"
              }
              className={cn(
                CONTROL,
                onSheet && packetOpen
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
                UNAVAILABLE
              )}
            >
              <HiOutlineDocumentText className="h-3.5 w-3.5" />
              <span className={WORD}>Packet</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
