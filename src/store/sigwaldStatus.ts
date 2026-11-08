import { create } from "zustand";

import { isDueToday } from "@/lib/sigwald/due";
import {
  type FocusQueueTask,
  parseTaskFromApi,
} from "@/lib/sigwald/parse-task";

/**
 * How long a fetched queue is considered fresh. The top bar asks for the queue
 * on every route change so the counts follow you around the app; without this
 * that would be a request per navigation. A minute is short enough that the
 * strip is never meaningfully wrong and long enough that clicking between
 * Calendar and Tasks costs nothing.
 */
const STALE_MS = 60_000;

interface SigwaldStatusStore {
  /** Every open task in its place (the queue's `inventory`): Today and the counts. */
  tasks: FocusQueueTask[];
  /** What to do next (the queue's `ranked`): resting work last, only what fits the free slot. */
  next: FocusQueueTask[];
  slotNarrative: string | null;
  status: "idle" | "loading" | "ready" | "error";
  fetchedAt: number | null;
  load: (opts?: { force?: boolean }) => Promise<void>;
  /** Drop a completed task locally so the counts fall immediately. */
  removeTask: (id: string) => void;
}

/**
 * The ranked Sigwald queue, shared by the top bar's status strip and the Today
 * dashboard. Today used to own this as component state, so the counts could
 * only ever be shown on /today; the strip is app-wide chrome now, and two
 * independent fetches of the same endpoint would be the obvious wrong answer.
 */
export const useSigwaldStatusStore = create<SigwaldStatusStore>((set, get) => ({
  tasks: [],
  next: [],
  slotNarrative: null,
  status: "idle",
  fetchedAt: null,

  load: async ({ force = false } = {}) => {
    const { status, fetchedAt } = get();
    if (status === "loading") {
      return;
    }
    if (!force && fetchedAt != null && Date.now() - fetchedAt < STALE_MS) {
      return;
    }
    // Only the very first load shows a loading state — a background refresh
    // must not blank the strip that's already on screen.
    set({ status: fetchedAt == null ? "loading" : status });
    try {
      const res = await fetch("/api/sigwald/focus/queue");
      if (!res.ok) {
        set({ status: "error" });
        return;
      }
      const data = await res.json();
      const next = (data.ranked ?? []).map(parseTaskFromApi);
      set({
        // A server from before `inventory` existed sends only `ranked`.
        tasks: data.inventory ? data.inventory.map(parseTaskFromApi) : next,
        next,
        slotNarrative: data.briefing?.slotNarrative ?? null,
        status: "ready",
        fetchedAt: Date.now(),
      });
    } catch {
      set({ status: "error" });
    }
  },

  removeTask: (id) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      next: s.next.filter((t) => t.id !== id),
    })),
}));

export function countDueToday(tasks: FocusQueueTask[]): number {
  return tasks.filter(isDueToday).length;
}

export function countDanger(tasks: FocusQueueTask[]): number {
  return tasks.filter(
    (t) => t.sigwald?.danger || t.sigwald?.urgencyTier === "DANGER"
  ).length;
}
