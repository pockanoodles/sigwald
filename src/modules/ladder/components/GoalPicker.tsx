"use client";

import { HiFlag, HiOutlineFlag } from "react-icons/hi";

import { ToolbarButton } from "@/components/tasks/TaskRow/ToolbarButton";
import type { TaskControlProps } from "@/components/tasks/lens";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

import { cn } from "@/lib/utils";

import { topGoalOf, useGoalTabStore } from "@/modules/ladder/goal-tabs";

/**
 * Ladder's control on a task (its Tasks lens): which goal the task works
 * toward. In an expanded row's toolbar it's a dropdown button; on a board
 * card it's a quiet chip that opens a select. Picking one pins the task to it.
 */
export function GoalPicker({ task, onPatch, variant }: TaskControlProps) {
  const topGoals = useGoalTabStore((s) => s.topGoals);
  const current = topGoalOf(task, topGoals);
  const choose = (goalId: string | null) => onPatch({ ...task, goalId });

  if (variant === "toolbar") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton
            active={Boolean(current)}
            aria-label="Goal"
            title="Link to a goal"
          >
            <HiOutlineFlag className="h-4 w-4" />
            <span className="hidden max-w-36 truncate sm:inline">
              {current ? current.title : "Goal"}
            </span>
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="rounded-none">
          <DropdownMenuItem onSelect={() => choose(null)}>
            No goal
          </DropdownMenuItem>
          {topGoals.map((goal) => (
            <DropdownMenuItem key={goal.id} onSelect={() => choose(goal.id)}>
              {goal.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Select
      value={current?.id || "none"}
      onValueChange={(value) => choose(value === "none" ? null : value)}
    >
      {/* Sized to sit in the card's meta line: the shared trigger is a
          full-width 14px field, which put this chip on a line of its own. */}
      <SelectTrigger
        className={cn(
          "h-auto w-auto max-w-full justify-start gap-1 border-none bg-transparent p-0 font-mono text-[11px] shadow-none transition-colors duration-150 focus:ring-0 md:text-[11px] [&>svg:last-child]:h-3 [&>svg:last-child]:w-3",
          current
            ? "text-muted-foreground hover:text-foreground"
            : "text-muted-foreground/50 hover:text-foreground"
        )}
        title="Link to a goal"
      >
        <HiFlag className="h-3 w-3 flex-none" />
        <span className="truncate">
          {current
            ? current.title
            : task.goalLinks?.length
              ? "Other cycle"
              : "No goal"}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No goal</SelectItem>
        {topGoals.map((goal) => (
          <SelectItem key={goal.id} value={goal.id}>
            {goal.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
