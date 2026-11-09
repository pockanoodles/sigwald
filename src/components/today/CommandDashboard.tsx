"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { FirstRun } from "@/components/today/FirstRun";
import { IntakeReview } from "@/components/today/IntakeReview";
import { Button } from "@/components/ui/button";
import { SwipeableRow } from "@/components/ui/swipeable-row";

import { formatEventTime } from "@/lib/calendar-event-display";
import { isDueToday } from "@/lib/sigwald/due";
import {
  type FocusQueueTask,
  primaryLadderGoal,
} from "@/lib/sigwald/parse-task";
import { cn } from "@/lib/utils";

import { CLIENT_MODULES } from "@/modules/client";

import { useModuleOn, useOnModules } from "@/store/modules";
import { useSettingsStore } from "@/store/settings";
import {
  countDanger,
  countDueToday,
  useSigwaldStatusStore,
} from "@/store/sigwaldStatus";

// Tier idiom, mirrored from FocusDesk so the whole app reads danger/urgency
// the same way: DANGER = red, HIGH-and-due-today = amber, else quiet.
function tierRowAccent(task: FocusQueueTask): string {
  const tier = task.sigwald?.urgencyTier;
  if (task.sigwald?.danger || tier === "DANGER") {
    return "border-l-2 border-l-destructive bg-destructive/10";
  }
  if (tier === "HIGH") {
    return "border-l-2 border-l-warning bg-warning/10";
  }
  return "border-l-2 border-l-transparent";
}

// Decompose'd task titles carry vault markdown (**bold**, `code`); strip the
// markers so the queue reads as plain text.
function plainTitle(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "");
}

/**
 * "Skipped · back 4:51 PM": a task Focus is passing over for now. Today keeps
 * it in its place and says so, rather than sinking or hiding it; the time is
 * when Focus serves it again, which is always before it's due.
 */
function RestMark({ task }: { task: FocusQueueTask }) {
  const timeFormat = useSettingsStore((s) => s.user.timeFormat);
  const rest = task.sigwald?.resting;
  if (!rest) return null;
  return (
    <span className="flex-none">
      {rest.reason === "skipped" ? "Skipped" : "Later"} · back{" "}
      {formatEventTime(new Date(rest.until), timeFormat)}
    </span>
  );
}

function tierBadge(
  task: FocusQueueTask
): { label: string; className: string } | null {
  const tier = task.sigwald?.urgencyTier;
  if (task.sigwald?.danger || tier === "DANGER") {
    return { label: "DANGER", className: "text-destructive" };
  }
  if (tier === "HIGH" && isDueToday(task)) {
    return { label: "DUE TODAY", className: "text-warning" };
  }
  return null;
}

export function CommandDashboard() {
  // The queue is shared with the top bar's status strip (store/sigwaldStatus.ts)
  // — this page used to own it, which is why the counts could only be seen
  // while standing on /today.
  const tasks = useSigwaldStatusStore((s) => s.tasks);
  const status = useSigwaldStatusStore((s) => s.status);
  const ladderOn = useModuleOn("ladder");
  const load = useSigwaldStatusStore((s) => s.load);
  const removeTask = useSigwaldStatusStore((s) => s.removeTask);
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? tasks[0] ?? null,
    [tasks, selectedId]
  );
  const dueTodayCount = useMemo(() => countDueToday(tasks), [tasks]);
  const dangerCount = useMemo(() => countDanger(tasks), [tasks]);

  const markDone = useCallback(
    async (id: string) => {
      // Optimistic: drop it and slide selection to the next task. The status
      // strip is reading the same list, so its counts fall at the same moment.
      const idx = tasks.findIndex((t) => t.id === id);
      const next = tasks.filter((t) => t.id !== id);
      removeTask(id);
      setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      toast("Task completed");
      try {
        await fetch("/api/sigwald/focus/interact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: id,
            action: "COMPLETED",
            sessionId: uuidv4(),
          }),
        });
      } catch {
        // A failed completion shouldn't silently look done — reload truth.
        load({ force: true });
      }
    },
    [tasks, removeTask, load]
  );

  const openTaskInFocus = useCallback(
    (id: string) => {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("sigwald-focus-boost", id);
      }
      router.push("/focus");
    },
    [router]
  );

  return (
    // No desktop header: the date and the counts sit in the app top bar at lg+.
    // Below lg (on a phone), the top bar drops those counts for room, so Today
    // prints a single compact readout strip at the top of the queue.
    <div className="flex h-full flex-col">
      {status === "ready" && tasks.length > 0 ? (
        <div className="flex flex-none items-center justify-between gap-2 border-b border-border bg-surface/60 px-4 py-2 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground tabular lg:hidden">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <span>{tasks.length} open</span>
            <span aria-hidden>·</span>
            <span>{dueTodayCount} due today</span>
            {dangerCount > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-semibold text-destructive">
                  {dangerCount} in danger
                </span>
              </>
            ) : null}
          </div>
          <Link
            href="/focus"
            className="er-slash flex-none font-semibold text-foreground transition-colors hover:text-rust-text"
          >
            Focus
          </Link>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_23rem] xl:grid-cols-[1fr_27rem]">
        {/* LEFT — the climb: ranked queue */}
        <section className="min-h-0 overflow-y-auto lg:border-r lg:border-border">
          {/* Work read out of announcements and messages that waits for a yes, above the queue it would join. */}
          <IntakeReview onAdded={() => load({ force: true })} />
          {(status === "idle" || status === "loading") && (
            <p className="p-6 text-sm text-muted-foreground">Loading today…</p>
          )}
          {status === "error" && (
            <p className="p-6 text-sm text-destructive">
              Today couldn&apos;t load. Try again in a moment, and if it keeps
              failing, Settings has the logs.
            </p>
          )}
          {status === "ready" && tasks.length === 0 && <FirstRun />}
          <ol>
            {tasks.map((task, i) => {
              const badge = tierBadge(task);
              const goal = primaryLadderGoal(task);
              const isSelected = selected?.id === task.id;
              const gi = task.gradeWeightPercent;
              return (
                <li key={task.id} className="border-b border-border">
                  <SwipeableRow
                    rightAction={{
                      label: "Done",
                      tone: "ok",
                      onTrigger: () => void markDone(task.id),
                    }}
                    leftAction={{
                      label: "Focus",
                      tone: "rust",
                      onTrigger: () => openTaskInFocus(task.id),
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(task.id)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors md:px-6",
                        tierRowAccent(task),
                        isSelected ? "bg-accent" : "hover:bg-muted/60"
                      )}
                    >
                      <span className="mt-0.5 w-5 flex-none font-mono text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {badge && (
                            <span
                              className={cn(
                                "flex-none font-mono text-[10px] font-semibold uppercase tracking-wide",
                                badge.className
                              )}
                            >
                              {badge.label}
                            </span>
                          )}
                          <span
                            className={cn(
                              "text-sm font-medium text-foreground",
                              isSelected
                                ? "line-clamp-2 lg:truncate"
                                : "truncate"
                            )}
                          >
                            {plainTitle(task.title)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <RestMark task={task} />
                          {task.sigwald?.resting &&
                            task.sigwald.countdownHuman && (
                              <span aria-hidden>·</span>
                            )}
                          {task.sigwald?.countdownHuman && (
                            <span>{task.sigwald.countdownHuman}</span>
                          )}
                          {task.courseName && <span>· {task.courseName}</span>}
                          {goal && (
                            <span className="truncate">· ↑ {goal.title}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </SwipeableRow>

                  {/* On a phone (< lg), the selected task expands inline right
                      under its row instead of splitting the screen in half. */}
                  {isSelected ? (
                    <div
                      className={cn(
                        "border-t border-border/60 bg-surface/50 px-4 py-2.5 pl-12 lg:hidden",
                        tierRowAccent(task)
                      )}
                    >
                      {(task.sigwald?.effortEstimate ||
                        (gi != null && gi > 0) ||
                        goal?.whyItMatters) && (
                        <div className="mb-2.5 space-y-1 text-xs text-muted-foreground">
                          {(task.sigwald?.effortEstimate ||
                            (gi != null && gi > 0)) && (
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
                              {task.sigwald?.effortEstimate ? (
                                <span>{task.sigwald.effortEstimate}</span>
                              ) : null}
                              {task.sigwald?.effortEstimate &&
                              gi != null &&
                              gi > 0 ? (
                                <span aria-hidden>·</span>
                              ) : null}
                              {gi != null && gi > 0 ? (
                                <span>{gi}% of grade</span>
                              ) : null}
                            </p>
                          )}
                          {goal?.whyItMatters ? (
                            <p className="line-clamp-2 leading-snug">
                              {goal.whyItMatters}
                            </p>
                          ) : null}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void markDone(task.id)}
                          className="h-9 min-w-[5.5rem]"
                        >
                          Done
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openTaskInFocus(task.id)}
                          className="h-9"
                        >
                          Start focus →
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>

        {/* RIGHT — the peak: the goal the selected task ladders to (desktop lg+) */}
        <aside className="hidden min-h-0 overflow-y-auto p-6 md:p-8 lg:block">
          {selected ? (
            <LadderPanel task={selected} onDone={markDone} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {ladderOn
                ? "Select a task to see the goal it climbs toward."
                : "Select a task to see it here."}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function LadderPanel({
  task,
  onDone,
}: {
  task: FocusQueueTask;
  onDone: (id: string) => void;
}) {
  const badge = tierBadge(task);
  const gi = task.gradeWeightPercent;
  const modules = useOnModules();

  return (
    <div>
      {/* The focused task */}
      <div>
        {badge && (
          <span
            className={cn(
              "font-mono text-xs font-semibold uppercase tracking-wide",
              badge.className
            )}
          >
            {badge.label}
          </span>
        )}
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {plainTitle(task.title)}
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <RestMark task={task} />
          {task.sigwald?.resting && task.sigwald.countdownHuman && (
            <span aria-hidden>·</span>
          )}
          {task.sigwald?.countdownHuman && (
            <span>{task.sigwald.countdownHuman}</span>
          )}
          {task.sigwald?.effortEstimate && (
            <>
              <span aria-hidden>·</span>
              <span>{task.sigwald.effortEstimate}</span>
            </>
          )}
          {task.courseName && (
            <>
              <span aria-hidden>·</span>
              <span>{task.courseName}</span>
            </>
          )}
          {gi != null && gi > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{gi}% of grade</span>
            </>
          )}
        </p>
      </div>

      {/* Sections modules add for the selected task (Ladder: the goal it
          climbs toward), each only while its module is on. */}
      {modules.map((m) => {
        const Section = CLIENT_MODULES[m.id].TodayTaskSection;
        return Section ? <Section key={m.id} task={task} /> : null;
      })}

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3 border-t border-border pt-6">
        <Button onClick={() => onDone(task.id)}>Done</Button>
        <Button asChild variant="ghost">
          <Link href="/focus">Enter focus mode →</Link>
        </Button>
      </div>
    </div>
  );
}
