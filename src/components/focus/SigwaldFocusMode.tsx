"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { v4 as uuidv4 } from "uuid";

import { Button } from "@/components/ui/button";

import { formatEventTime } from "@/lib/calendar-event-display";
import { endOfDay, newDate } from "@/lib/date-utils";
import {
  type FocusQueueTask,
  parseTaskFromApi,
} from "@/lib/sigwald/parse-task";

import { useSettingsStore } from "@/store/settings";
import { useTaskStore } from "@/store/task";

import type { BriefingData } from "@/types/focus-briefing";
import { TaskStatus } from "@/types/task";

import { CompactBriefing } from "./CompactBriefing";
import { DailyBriefing } from "./DailyBriefing";
import { FocusDesk } from "./FocusDesk";
import { QuickAdd } from "./QuickAdd";

const STORAGE_LAST_BRIEFING = "sigwald-last-briefing";
const STORAGE_FOCUS_BOOST = "sigwald-focus-boost";

function localDayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface QueueResponse {
  ranked: Record<string, unknown>[];
  /** Every open task, including ones Focus passes over (Today's list). */
  inventory?: Record<string, unknown>[];
  briefing?: Record<string, unknown>;
}

/**
 * Sigwald Focus: briefing gate, queue, TaskInteraction logging (docs/focus-mode.md).
 */
export function SigwaldFocusMode() {
  const [mounted, setMounted] = useState(false);
  const [ranked, setRanked] = useState<FocusQueueTask[]>([]);
  const [briefingData, setBriefingData] = useState<BriefingData | null>(null);
  const [showFullBriefing, setShowFullBriefing] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Non-error feedback for an action that legitimately changed nothing. */
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const sessionId = useRef(uuidv4());
  const surfaceLoggedRef = useRef<Set<string>>(new Set());
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  /**
   * `background: true` refetches without dropping to the loading state, so the
   * card already on screen stays put until its replacement arrives. Flashing
   * "Loading your next task..." between two cards is what made Skip read as a
   * flicker rather than a transition.
   */
  const loadQueue = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setQueueLoading(true);
    }
    setError(null);
    try {
      const res = await fetch("/api/sigwald/focus/queue");
      if (!res.ok) {
        throw new Error("Failed to load focus queue");
      }
      const data = (await res.json()) as QueueResponse;
      let list = data.ranked.map((r) => parseTaskFromApi(r));
      if (typeof window !== "undefined") {
        const boost = sessionStorage.getItem(STORAGE_FOCUS_BOOST);
        if (boost) {
          sessionStorage.removeItem(STORAGE_FOCUS_BOOST);
          // Opened from Today, the task may be one the queue passes over
          // (resting, or longer than the free slot): it's in the full list.
          const raw = (data.inventory ?? []).find((x) => x.id === boost);
          const t =
            list.find((x) => x.id === boost) ??
            (raw ? parseTaskFromApi(raw) : undefined);
          if (t) {
            list = [t, ...list.filter((x) => x.id !== boost)];
          }
        }
      }
      setRanked(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      return null;
    } finally {
      if (!background) {
        setQueueLoading(false);
      }
    }
  }, []);

  const loadBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const res = await fetch("/api/sigwald/focus/briefing");
      if (!res.ok) {
        throw new Error("Failed to load briefing");
      }
      const data = (await res.json()) as BriefingData;
      setBriefingData(data);
    } catch {
      setBriefingData(null);
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const last = localStorage.getItem(STORAGE_LAST_BRIEFING);
    const today = localDayKey();
    if (last !== today) {
      setShowFullBriefing(true);
    } else {
      setShowFullBriefing(false);
    }
    void loadQueue();
    void loadBriefing();
  }, [mounted, loadQueue, loadBriefing]);

  const logInteraction = useCallback(
    async (taskId: string, action: "COMPLETED" | "SKIPPED" | "SURFACED") => {
      const tz =
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
      const res = await fetch("/api/sigwald/focus/interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          action,
          sessionId: sessionId.current,
          clientTimezone: tz,
          context: {
            timeOfDayFloat:
              new Date().getHours() + new Date().getMinutes() / 60,
            dayOfWeek: new Date().getDay(),
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error ?? "Interaction failed"
        );
      }
    },
    []
  );

  const top = ranked[0] ?? null;
  const upNext = ranked.slice(1, 3);

  useEffect(() => {
    if (!top?.id || queueLoading) {
      return;
    }
    const key = top.id;
    if (surfaceLoggedRef.current.has(key)) {
      return;
    }
    surfaceLoggedRef.current.add(key);
    void logInteraction(key, "SURFACED").catch(() => {
      surfaceLoggedRef.current.delete(key);
    });
  }, [top?.id, queueLoading, logInteraction]);

  const handleDone = async () => {
    if (!top) {
      return;
    }
    setActing(true);
    setNotice(null);
    try {
      await logInteraction(top.id, "COMPLETED");
      // Completion changes the task itself, so the shared store other views
      // read from has to be refreshed too.
      await fetchTasks();
      await loadQueue({ background: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete task");
    } finally {
      setActing(false);
    }
  };

  const timeFormat = useSettingsStore((st) => st.user.timeFormat);

  const handleSkip = async () => {
    if (!top) {
      return;
    }
    setActing(true);
    setNotice(null);
    // The task re-enters the queue once its cooldown lapses, and that is a
    // genuine new surfacing — drop it from the dedupe set so it logs SURFACED
    // again instead of returning silently.
    surfaceLoggedRef.current.delete(top.id);
    try {
      await logInteraction(top.id, "SKIPPED");
      // No `fetchTasks()` here: skipping touches only `skipCount` /
      // `lastSkippedAt`, which nothing outside the focus queue reads, and the
      // extra round-trip only lengthened the gap before the next card.
      const next = await loadQueue({ background: true });
      // Resting is a sort key, not a filter, so when it's the only task left
      // — or everything else already rests — the same card comes back. So
      // does one due too soon to rest at all. Say which, otherwise the button
      // silently does nothing.
      if (next && next[0]?.id === top.id) {
        setNotice(
          !next[0].sigwald?.resting
            ? tooCloseToPutOff(next[0])
            : next.length === 1
              ? "That's the only task in your queue right now."
              : "Everything else is already skipped — this is still the top one."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skip failed");
    } finally {
      setActing(false);
    }
  };

  /**
   * Put the task off until the end of today. Same stamp as TaskRow's
   * "Later today" preset. One due before then isn't hidden: it stays on Today
   * and comes back to Focus ahead of its deadline (rank-stage1 `restOf`).
   */
  const handleLater = async () => {
    if (!top) {
      return;
    }
    setActing(true);
    setNotice(null);
    const until = endOfDay(newDate());
    try {
      const res = await fetch(`/api/tasks/${top.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postponedUntil: until.toISOString() }),
      });
      if (!res.ok) {
        throw new Error("Could not defer task");
      }
      await fetchTasks();
      const next = await loadQueue({ background: true });
      const after = next?.find((t) => t.id === top.id);
      if (after && !after.sigwald?.resting) {
        setNotice(tooCloseToPutOff(after));
      } else if (
        after?.sigwald?.resting &&
        new Date(after.sigwald.resting.until) < until
      ) {
        setNotice(
          `It's due before the day ends, so it's back here at ${formatEventTime(
            new Date(after.sigwald.resting.until),
            timeFormat
          )}.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not defer task");
    } finally {
      setActing(false);
    }
  };

  const handleToggleSubtask = async (id: string, completed: boolean) => {
    setActing(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: completed ? TaskStatus.COMPLETED : TaskStatus.TODO,
        }),
      });
      if (!res.ok) {
        throw new Error("Could not update subtask");
      }
      await loadQueue({ background: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update subtask");
    } finally {
      setActing(false);
    }
  };

  useEffect(() => {
    if (!top || showFullBriefing) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || acting) {
        return;
      }
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== "d" && key !== "s" && key !== "l") {
        return;
      }
      e.preventDefault();
      if (key === "d") void handleDone();
      else if (key === "s") void handleSkip();
      else void handleLater();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleQuickAdd = async () => {
    const title = newTitle.trim();
    if (!title) {
      setAddError("Enter a title");
      return;
    }
    setAddError(null);
    setActing(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          status: TaskStatus.TODO,
          source: "LOCAL",
          category: "PERSONAL",
          duration: 30,
          priority: "medium",
        }),
      });
      if (!res.ok) {
        throw new Error("Could not create task");
      }
      setNewTitle("");
      setAddOpen(false);
      await fetchTasks();
      await loadBriefing();
      await loadQueue();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setActing(false);
    }
  };

  const dismissBriefingAndPersist = useCallback(async () => {
    localStorage.setItem(STORAGE_LAST_BRIEFING, localDayKey());
    setShowFullBriefing(false);
    await loadQueue();
  }, [loadQueue]);

  const summaryLine = useMemo(() => {
    if (!briefingData) {
      return "";
    }
    const parts: string[] = [];
    parts.push(`${briefingData.tasksCompletedToday} done today`);
    if (briefingData.nextEvent) {
      parts.push(
        `Next: ${briefingData.nextEvent.title} ${briefingData.nextEvent.startsIn}`
      );
    }
    if (briefingData.dangerZoneTasks.length > 0) {
      const n = briefingData.dangerZoneTasks.length;
      parts.push(`${n} ${n === 1 ? "task" : "tasks"} in danger`);
    }
    return parts.join(" · ");
  }, [briefingData]);

  if (!mounted) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-muted-foreground">Loading Focus...</p>
      </div>
    );
  }

  // An empty day has nothing to brief: it goes straight to the empty state,
  // which says how to give Focus something, instead of a full-screen
  // "Let's go" over nothing.
  const emptyDay = briefingData?.totalPendingTasks === 0;
  const fullBriefing = showFullBriefing && !emptyDay;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {fullBriefing && briefingLoading ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
          <p className="text-muted-foreground">Loading briefing…</p>
        </div>
      ) : null}
      {fullBriefing && briefingData && !briefingLoading ? (
        <DailyBriefing
          data={briefingData}
          onContinue={dismissBriefingAndPersist}
        />
      ) : null}

      {!fullBriefing ? (
        <CompactBriefing
          data={briefingData}
          summaryLine={summaryLine || "Briefing"}
          loading={briefingLoading}
        />
      ) : null}

      {error ? (
        <p className="px-4 py-2 text-sm text-destructive md:px-8" role="alert">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p
          className="px-4 py-2 text-sm text-muted-foreground md:px-8"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {queueLoading ? (
          <p className="px-6 py-8 text-[13px] text-muted-foreground">
            Loading your next task...
          </p>
        ) : emptyDay ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <p className="text-[15px] font-medium text-foreground">
              Nothing to focus on yet.
            </p>
            <p className="mt-2 max-w-sm text-[13px] text-muted-foreground">
              Focus shows the top of Today one task at a time. Add a task, or
              turn on a module on Today that brings its own work.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                Add a task
              </Button>
              <Button asChild variant="quiet">
                <Link href="/today">Back to Today</Link>
              </Button>
            </div>
          </div>
        ) : !top ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <p className="text-[15px] font-medium text-foreground">
              All clear.
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              0 tasks pending.
            </p>
            {briefingData ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                You completed {briefingData.tasksCompletedToday} tasks today.
              </p>
            ) : null}
          </div>
        ) : (
          <FocusDesk
            task={top}
            upNext={upNext}
            position={{ index: 1, total: ranked.length }}
            doneToday={briefingData?.tasksCompletedToday ?? null}
            freeHours={briefingData?.freeHoursToday ?? null}
            nextEvent={briefingData?.nextEvent ?? null}
            acting={acting}
            onDone={() => void handleDone()}
            onSkip={() => void handleSkip()}
            onLater={() => void handleLater()}
            onToggleSubtask={(id, completed) =>
              void handleToggleSubtask(id, completed)
            }
          />
        )}
      </div>

      <QuickAdd
        open={addOpen}
        title={newTitle}
        onTitleChange={setNewTitle}
        onSubmit={() => void handleQuickAdd()}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) {
            setAddError(null);
          }
        }}
        acting={acting}
        error={addError}
      />
    </div>
  );
}

/** Why Skip or Later left a task where it was: it's due too soon to put off. */
function tooCloseToPutOff(task: FocusQueueTask): string {
  const left = task.sigwald?.countdownHuman;
  return `${left ? `${left}: ` : ""}too close to its deadline to put off. Mark it done if it's handled.`;
}
