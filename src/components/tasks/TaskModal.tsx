import { useCallback, useEffect, useRef, useState } from "react";

import { RRule } from "rrule";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingOverlay } from "@/components/ui/loading-overlay";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { format, newDate, taskDay } from "@/lib/date-utils";
import { RecurrenceConverterFactory } from "@/lib/task-sync/recurrence/recurrence-converter-factory";
import { cn } from "@/lib/utils";

import { useTaskModule } from "@/modules/client";

import { useModuleOn } from "@/store/modules";
import { useProjectStore } from "@/store/project";

import {
  EnergyLevel,
  NewTask,
  Priority,
  Tag,
  Task,
  TaskStatus,
  TimePreference,
} from "@/types/task";

import { formatEnumValue } from "./utils/task-list-utils";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: NewTask) => Promise<void>;
  task?: Task;
  tags: Tag[];
  onCreateTag: (name: string, color?: string) => Promise<Tag>;
  initialProjectId?: string | null;
  /** Pre-links a created task to a goal (the Tasks page's open goal tab). */
  initialGoalId?: string | null;
  /**
   * Offers Delete while editing. The caller confirms and closes: the board's
   * cards carry no delete of their own, so this is where it lives.
   */
  onDelete?: (taskId: string) => Promise<void> | void;
}

/** Date -> the "YYYY-MM-DDTHH:mm" a `datetime-local` input expects, in local
 *  time. `toISOString()` would shift it to UTC and show the wrong clock time. */
const toDateTimeInput = (value: Date | string | null | undefined): string => {
  if (!value) return "";
  const d = newDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// Helper function to convert external recurrence rule to RRule format
function getStandardRRule(task?: Task): RRule {
  if (!task?.recurrenceRule) {
    return new RRule({
      freq: RRule.WEEKLY,
      interval: 1,
      byweekday: [RRule.MO],
    });
  }

  // If the task has a source (e.g., OUTLOOK), use the appropriate converter
  if (task.source) {
    const converter = RecurrenceConverterFactory.getConverter(task.source);
    const standardRule = converter.convertFromString(task.recurrenceRule);
    return RRule.fromString(standardRule);
  }

  // If no source or internal task, assume it's already in RRule format
  return RRule.fromString(task.recurrenceRule);
}

/** The form's date fields as they were when the dialog opened. */
interface DateFields {
  dueDate: string;
  startDate: string;
  postponedUntil: string;
  scheduledStart: string;
  scheduledEnd: string;
}

const NO_DATES: DateFields = {
  dueDate: "",
  startDate: "",
  postponedUntil: "",
  scheduledStart: "",
  scheduledEnd: "",
};

/**
 * A day picked in the due-date field, as the moment to store. A deadline that
 * carried a time (Canvas: 11:59 PM, 7:00 AM) keeps that time on its new day;
 * one without stays a bare date (UTC midnight, read as the end of that day).
 */
function dueOnDay(day: string, before: Date | string | null | undefined): Date {
  if (before) {
    const was = newDate(before);
    const bare =
      was.getUTCHours() === 0 &&
      was.getUTCMinutes() === 0 &&
      was.getUTCSeconds() === 0 &&
      was.getUTCMilliseconds() === 0;
    if (!bare) {
      const [y, m, d] = day.split("-").map(Number);
      return new Date(y, m - 1, d, was.getHours(), was.getMinutes(), was.getSeconds());
    }
  }
  return newDate(day);
}

export function TaskModal({
  isOpen,
  onClose,
  onSave,
  task,
  tags,
  onCreateTag,
  initialProjectId,
  initialGoalId,
  onDelete,
}: TaskModalProps) {
  const { projects } = useProjectStore();
  // A task a module owns (a Canvas assignment, a workout, a timesheet) reads
  // through that module's pane, as in the sheet: its description is the
  // module's (for Canvas, raw HTML), so it's neither shown as text nor saved
  // back from here.
  const owner = useTaskModule(task?.source);
  const ModulePane = task ? owner?.TaskPane : undefined;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.TODO);
  const [dueDate, setDueDate] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [postponedUntil, setPostponedUntil] = useState<string>("");
  const [duration, setDuration] = useState<string>("");
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel | "">("");
  const [preferredTime, setPreferredTime] = useState<TimePreference | "">("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#E5E7EB");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectId, setProjectId] = useState<string | null | undefined>(
    initialProjectId || task?.projectId
  );
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<string | undefined>();
  const [isAutoScheduled, setIsAutoScheduled] = useState(
    task?.isAutoScheduled || false
  );
  const [scheduleLocked, setScheduleLocked] = useState(
    task?.scheduleLocked || false
  );
  // `datetime-local` strings ("YYYY-MM-DDTHH:mm"), converted on submit.
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [priority, setPriority] = useState<Priority | null>(
    task?.priority || null
  );
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goals, setGoals] = useState<{ id: string; title: string }[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const ladderOn = useModuleOn("ladder");
  const titleInputRef = useRef<HTMLInputElement>(null);
  // What the date fields held when the dialog opened. A field left as it was
  // isn't sent: the inputs only hold a day (or a minute), so echoing them
  // back turned a Canvas deadline at 7:00 AM into midnight UTC, 7 PM the
  // evening before, on every save of any other field.
  const openedDates = useRef<DateFields>(NO_DATES);

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setStatus(TaskStatus.TODO);
    setDueDate("");
    setStartDate("");
    setPostponedUntil("");
    setDuration("");
    setEnergyLevel("");
    setPreferredTime("");
    setSelectedTagIds([]);
    setNewTagName("");
    setNewTagColor("#E5E7EB");
    setProjectId(initialProjectId ?? null);
    setIsRecurring(false);
    setRecurrenceRule(undefined);
    setIsAutoScheduled(true);
    setScheduleLocked(false);
    setScheduledStart("");
    setScheduledEnd("");
    setPriority(null);
    setGoalId(initialGoalId ?? null);
    setShowAdvanced(false);
  }, [initialProjectId, initialGoalId]);

  // Goals in the active cycle, for the optional goal link (Ladder's, so only
  // while Ladder is on)
  useEffect(() => {
    if (!isOpen || !ladderOn) return;
    let cancelled = false;
    fetch("/api/sigwald/goals")
      .then((res) => (res.ok ? res.json() : []))
      .then((json: { id: string; title: string }[]) => {
        if (!cancelled) setGoals(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, ladderOn]);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  // Populate form with task data when editing
  useEffect(() => {
    if (task && isOpen) {
      setTitle(task.title);
      setDescription(task.description || "");
      setStatus(task.status);
      // Handle date string from API
      // The day each stored date names: a deadline with a time (11:59 PM)
      // is on its own local day, not UTC's.
      if (task.dueDate) {
        setDueDate(format(taskDay(newDate(task.dueDate)), "yyyy-MM-dd"));
      } else {
        setDueDate("");
      }
      if (task.startDate) {
        setStartDate(format(taskDay(newDate(task.startDate)), "yyyy-MM-dd"));
      } else {
        setStartDate("");
      }
      setPostponedUntil(toDateTimeInput(task.postponedUntil));
      openedDates.current = {
        dueDate: task.dueDate
          ? format(taskDay(newDate(task.dueDate)), "yyyy-MM-dd")
          : "",
        startDate: task.startDate
          ? format(taskDay(newDate(task.startDate)), "yyyy-MM-dd")
          : "",
        postponedUntil: toDateTimeInput(task.postponedUntil),
        scheduledStart: toDateTimeInput(task.scheduledStart),
        scheduledEnd: toDateTimeInput(task.scheduledEnd),
      };
      setDuration(task.duration?.toString() || "");
      setEnergyLevel(task.energyLevel || "");
      setPreferredTime(task.preferredTime || "");
      setSelectedTagIds(task.tags.map((t) => t.id));
      setProjectId(task.projectId || null);
      setIsRecurring(task.isRecurring);
      setRecurrenceRule(task.recurrenceRule || undefined);
      setIsAutoScheduled(task.isAutoScheduled);
      setScheduleLocked(task.scheduleLocked);
      setScheduledStart(toDateTimeInput(task.scheduledStart));
      setScheduledEnd(toDateTimeInput(task.scheduledEnd));
      setPriority(task.priority || null);
      setGoalId(task.goalLinks?.[0]?.goalId ?? null);
      setShowAdvanced(
        Boolean(
          task.description ||
            task.startDate ||
            task.postponedUntil ||
            task.energyLevel ||
            task.preferredTime ||
            task.scheduledStart ||
            task.tags.length > 0 ||
            task.isRecurring
        )
      );
    } else if (!task && isOpen) {
      openedDates.current = NO_DATES;
      resetForm();
    }
  }, [task, isOpen, initialProjectId, resetForm]);

  // Focus title input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      // Setting a time by hand means keeping it. Every save triggers a full
      // re-schedule, and that run clears `scheduledStart` on any auto-scheduled
      // task that isn't locked — so without this the time would be written and
      // wiped in the same submit. Same rule as dragging on the calendar
      // (see components/calendar/useTaskReschedule.ts).
      const scheduleChanged =
        scheduledStart !== toDateTimeInput(task?.scheduledStart) ||
        scheduledEnd !== toDateTimeInput(task?.scheduledEnd);
      const hasManualTime = Boolean(scheduledStart && scheduledEnd);

      // Only the date fields that were changed: undefined leaves the stored
      // moment alone, null clears it.
      const opened = openedDates.current;
      const changed = <K extends keyof DateFields>(field: K, value: string) =>
        !task || value !== opened[field];
      await onSave({
        title: title.trim(),
        description: ModulePane ? undefined : description.trim() || undefined,
        status,
        dueDate: !changed("dueDate", dueDate)
          ? undefined
          : dueDate
            ? dueOnDay(dueDate, task?.dueDate)
            : null,
        startDate: !changed("startDate", startDate)
          ? undefined
          : startDate
            ? newDate(startDate)
            : null,
        postponedUntil: !changed("postponedUntil", postponedUntil)
          ? undefined
          : postponedUntil
            ? newDate(postponedUntil)
            : null,
        duration: duration ? parseInt(duration, 10) : undefined,
        energyLevel: energyLevel || undefined,
        preferredTime: preferredTime || undefined,
        tagIds: selectedTagIds,
        projectId: projectId,
        isRecurring,
        recurrenceRule: isRecurring ? recurrenceRule : undefined,
        isAutoScheduled,
        scheduleLocked:
          scheduleChanged && hasManualTime ? true : scheduleLocked,
        scheduledStart: !changed("scheduledStart", scheduledStart)
          ? undefined
          : scheduledStart
            ? newDate(scheduledStart)
            : null,
        scheduledEnd: !changed("scheduledEnd", scheduledEnd)
          ? undefined
          : scheduledEnd
            ? newDate(scheduledEnd)
            : null,
        priority,
        goalId,
      });
      onClose();
    } catch (error) {
      console.error("Error saving task:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;

    try {
      const tag = await onCreateTag(newTagName.trim(), newTagColor);
      setSelectedTagIds([...selectedTagIds, tag.id]);
      setNewTagName("");
      setNewTagColor("#E5E7EB");
    } catch (error) {
      console.error("Error creating tag:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[500px]">
        {isSubmitting && <LoadingOverlay />}
        <DialogHeader>
          <DialogTitle>{task ? "Edit Task" : "New Task"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {ModulePane && task && owner ? (
            <section aria-label={`From ${owner.manifest.name}`}>
              <Label asChild>
                <span>From {owner.manifest.name}</span>
              </Label>
              <div className="mt-1.5 max-h-[45vh] overflow-y-auto border border-border">
                <ModulePane taskId={task.id} />
              </div>
            </section>
          ) : (
            <div className={cn(!showAdvanced && "hidden sm:block")}>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="dueDate">Due Date</Label>
              <Input
                type="date"
                id="dueDate"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={priority || Priority.NONE}
                onValueChange={(value) => setPriority(value as Priority)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {formatEnumValue(priority || Priority.NONE)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.values(Priority).map((level) => (
                    <SelectItem key={level} value={level}>
                      {formatEnumValue(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                type="number"
                id="duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min="0"
              />
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue>{formatEnumValue(status)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TaskStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      {formatEnumValue(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className={cn(!showAdvanced && "hidden sm:block")}>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                type="date"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional: Task won&apos;t be scheduled before this date
              </p>
            </div>

            <div className={cn(!showAdvanced && "hidden sm:block")}>
              <Label htmlFor="postponedUntil">Defer until</Label>
              <Input
                type="datetime-local"
                id="postponedUntil"
                value={postponedUntil}
                onChange={(e) => setPostponedUntil(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Hidden from Focus and Tasks until this time
              </p>
            </div>

            <div className={cn(!showAdvanced && "hidden sm:block")}>
              <Label htmlFor="energyLevel">Energy Level</Label>
              <Select
                value={energyLevel || "none"}
                onValueChange={(value) =>
                  setEnergyLevel(value === "none" ? "" : (value as EnergyLevel))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None">
                    {energyLevel ? formatEnumValue(energyLevel) : "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {Object.values(EnergyLevel).map((level) => (
                    <SelectItem key={level} value={level}>
                      {formatEnumValue(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className={cn(!showAdvanced && "hidden sm:block")}>
              <Label htmlFor="preferredTime">Preferred Time</Label>
              <Select
                value={preferredTime || "none"}
                onValueChange={(value) =>
                  setPreferredTime(
                    value === "none" ? "" : (value as TimePreference)
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None">
                    {preferredTime ? formatEnumValue(preferredTime) : "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {Object.values(TimePreference).map((time) => (
                    <SelectItem key={time} value={time}>
                      {formatEnumValue(time)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!showAdvanced ? (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="er-slash font-mono text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground sm:hidden"
            >
              More options (notes, schedule, tags, repeat)
            </button>
          ) : null}

          <div
            className={cn(
              "space-y-4 border-t pt-2",
              !showAdvanced && "hidden sm:block"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Schedule</Label>
                <p className="text-sm text-muted-foreground">
                  Let the system schedule this task automatically
                </p>
              </div>
              <Switch
                checked={isAutoScheduled}
                onCheckedChange={setIsAutoScheduled}
              />
            </div>

            {isAutoScheduled && (
              <div className="flex items-center justify-between">
                <div>
                  <Label>Lock Schedule</Label>
                  <p className="text-sm text-muted-foreground">
                    Prevent automatic rescheduling
                  </p>
                </div>
                <Switch
                  checked={scheduleLocked}
                  onCheckedChange={setScheduleLocked}
                />
              </div>
            )}

            {/* Deliberately outside the Auto-Schedule branch. This block used
                to be read-only text, and only visible when auto-scheduling was
                on — so the one case where you most wanted to set a time by
                hand was the case where the field wasn't rendered. */}
            <div className="space-y-2">
              <Label>Scheduled time</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Start</span>
                  <Input
                    type="datetime-local"
                    value={scheduledStart}
                    onChange={(e) => {
                      const next = e.target.value;
                      setScheduledStart(next);
                      // Keep the block the length the estimate says, so setting
                      // a start is one interaction instead of two.
                      if (next && !scheduledEnd) {
                        const mins = parseInt(duration, 10);
                        const end = newDate(next);
                        end.setMinutes(
                          end.getMinutes() +
                            (Number.isFinite(mins) && mins > 0 ? mins : 30)
                        );
                        setScheduledEnd(toDateTimeInput(end));
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">End</span>
                  <Input
                    type="datetime-local"
                    value={scheduledEnd}
                    onChange={(e) => setScheduledEnd(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {scheduledStart && scheduledEnd
                    ? "A time you set by hand is locked, so auto-schedule won't move it."
                    : "Leave empty to let auto-schedule place this task."}
                </p>
                {(scheduledStart || scheduledEnd) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="flex-none"
                    onClick={() => {
                      setScheduledStart("");
                      setScheduledEnd("");
                      setScheduleLocked(false);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>

              {task?.scheduleScore ? (
                <p className="text-xs text-muted-foreground">
                  Auto-schedule confidence:{" "}
                  {Math.round(task.scheduleScore * 100)}%
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <Label htmlFor="project">Project</Label>
            <Select
              value={projectId || "none"}
              onValueChange={(value) =>
                setProjectId(value === "none" ? null : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Project</SelectItem>
                {projects
                  .filter((p) => p.status === "active")
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {ladderOn && (goals.length > 0 || goalId) && (
            <div>
              <Label htmlFor="goal">Goal</Label>
              <Select
                value={goalId || "none"}
                onValueChange={(value) =>
                  setGoalId(value === "none" ? null : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No Goal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Goal</SelectItem>
                  {goals.map((goal) => (
                    <SelectItem key={goal.id} value={goal.id}>
                      {goal.title}
                    </SelectItem>
                  ))}
                  {goalId && !goals.some((g) => g.id === goalId) ? (
                    <SelectItem value={goalId}>
                      Linked goal (past season)
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Goal-linked tasks rank higher this season
              </p>
            </div>
          )}

          <div className={cn(!showAdvanced && "hidden sm:block")}>
            <Label>Tags</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className={cn(
                    "inline-flex cursor-pointer items-center rounded-full px-3 py-1.5 text-sm transition-colors",
                    selectedTagIds.includes(tag.id)
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  <Checkbox
                    className="sr-only"
                    checked={selectedTagIds.includes(tag.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedTagIds([...selectedTagIds, tag.id]);
                      } else {
                        setSelectedTagIds(
                          selectedTagIds.filter((id) => id !== tag.id)
                        );
                      }
                    }}
                  />
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color || "var(--muted)" }}
                  />
                  {tag.name}
                </label>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="New tag name"
              />
              <Input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="h-9 w-9 p-1"
              />
              <Button
                type="button"
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
                variant="secondary"
              >
                Add Tag
              </Button>
            </div>
          </div>

          <div className={cn("space-y-2", !showAdvanced && "hidden sm:block")}>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="recurring"
                checked={isRecurring}
                onCheckedChange={(checked) => {
                  setIsRecurring(checked as boolean);
                  if (checked) {
                    if (!dueDate) {
                      const today = newDate();
                      setDueDate(today.toISOString().split("T")[0]);
                    }
                    if (!recurrenceRule) {
                      setRecurrenceRule(
                        new RRule({
                          freq: RRule.WEEKLY,
                          interval: 1,
                          byweekday: [RRule.MO],
                        }).toString()
                      );
                    }
                  }
                }}
              />
              <Label htmlFor="recurring">Make this a recurring task</Label>
            </div>
            {isRecurring && !dueDate && (
              <div className="ml-6 mt-1 text-sm text-primary">
                A recurring task needs a start date. Today has been set as the
                default.
              </div>
            )}
            {isRecurring && (
              <div className="mt-2 space-y-3 pl-6">
                <div>
                  <Label>Repeat every</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={
                        recurrenceRule
                          ? getStandardRRule({
                              recurrenceRule,
                              source: task?.source,
                            } as Task).options.interval || 1
                          : 1
                      }
                      onChange={(e) => {
                        const interval = parseInt(e.target.value) || 1;
                        const currentRule = recurrenceRule
                          ? getStandardRRule({
                              recurrenceRule,
                              source: task?.source,
                            } as Task)
                          : new RRule({
                              freq: RRule.WEEKLY,
                              interval: 1,
                              byweekday: [RRule.MO],
                            });
                        setRecurrenceRule(
                          new RRule({
                            ...currentRule.options,
                            interval,
                          }).toString()
                        );
                      }}
                      className="w-20"
                    />
                    <Select
                      value={
                        recurrenceRule
                          ? getStandardRRule({
                              recurrenceRule,
                              source: task?.source,
                            } as Task).options.freq.toString()
                          : RRule.WEEKLY.toString()
                      }
                      onValueChange={(value) => {
                        const freq = parseInt(value);
                        const currentRule = recurrenceRule
                          ? getStandardRRule({
                              recurrenceRule,
                              source: task?.source,
                            } as Task)
                          : new RRule({
                              freq: RRule.WEEKLY,
                              interval: 1,
                              byweekday: [RRule.MO],
                            });
                        setRecurrenceRule(
                          new RRule({
                            ...currentRule.options,
                            freq,
                            byweekday:
                              freq === RRule.WEEKLY ? [RRule.MO] : null,
                          }).toString()
                        );
                      }}
                    >
                      <SelectTrigger className="w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={RRule.DAILY.toString()}>
                          days
                        </SelectItem>
                        <SelectItem value={RRule.WEEKLY.toString()}>
                          weeks
                        </SelectItem>
                        <SelectItem value={RRule.MONTHLY.toString()}>
                          months
                        </SelectItem>
                        <SelectItem value={RRule.YEARLY.toString()}>
                          years
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            {task && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onDelete(task.id)}
                className="mr-auto text-destructive hover:text-destructive"
              >
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !title.trim()}>
              {isSubmitting ? "Saving..." : task ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
