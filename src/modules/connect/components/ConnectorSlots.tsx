"use client";

import { useEffect } from "react";

import { usePathname } from "next/navigation";

import { create } from "zustand";

import type { FocusQueueTask } from "@/lib/sigwald/parse-task";

import { moduleById } from "@/modules";
import {
  type ItemPaneView,
  type StatusReading,
  formatReading,
} from "@/modules/connect/views";
import type { ModuleId } from "@/modules/types";

import { useResource } from "@/hooks/use-resource";

/**
 * The slots every connector module shares (src/modules/connect/client.ts):
 * what a task it made shows in the task sheet and in Focus, and its count in
 * the top bar.
 */

function useItem(taskId: string) {
  return useResource<ItemPaneView>(
    `/api/connect/items/${encodeURIComponent(taskId)}`
  );
}

function seenLabel(view: ItemPaneView): string {
  const service =
    moduleById(view.module).connect?.service?.name ??
    moduleById(view.module).name;
  const state =
    view.state === "done"
      ? `Done in ${service}`
      : view.state === "gone"
        ? `No longer in ${service}`
        : `Open in ${service}`;
  const mins = Math.round(
    (Date.now() - new Date(view.seenAt).getTime()) / 60_000
  );
  const when =
    mins < 1
      ? "just now"
      : mins < 60
        ? `${mins} min ago`
        : mins < 2880
          ? `${Math.round(mins / 60)} h ago`
          : `${Math.round(mins / 1440)} days ago`;
  return `${state} · seen ${when}`;
}

function Facts({ view }: { view: ItemPaneView }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">{seenLabel(view)}</p>
      {view.facts.length > 0 ? (
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {view.facts.map((f) => (
              <tr key={f.label} className="border-t border-border">
                <td className="w-28 py-1.5 pr-3 align-top text-muted-foreground">
                  {f.label}
                </td>
                <td className="break-words py-1.5 text-foreground">
                  {f.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {view.url ? (
        <a
          href={view.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[14px] text-foreground underline decoration-border underline-offset-4 hover:text-rust-text"
        >
          {moduleById(view.module).linkLabels?.[
            moduleById(view.module).sources[0]
          ] ?? "Open where it lives"}
        </a>
      ) : null}
      <p className="text-[12px] text-muted-foreground">
        {moduleById(view.module).name} keeps this in step with where it lives:
        change it there.
      </p>
    </div>
  );
}

/** The task sheet's reading pane for a task a connector module made. */
export function ConnectorTaskPane({ taskId }: { taskId: string }) {
  const { data, error } = useItem(taskId);
  return (
    <div className="p-4">
      {data ? (
        <>
          <h2 className="er-display mb-3 text-lg text-foreground">
            {data.title}
          </h2>
          <Facts view={data} />
        </>
      ) : (
        <p className="text-[14px] text-muted-foreground">
          {error ? "It couldn't load." : "Loading…"}
        </p>
      )}
    </div>
  );
}

/** Focus's context column for a task a connector module made. */
export function ConnectorTaskContext({ task }: { task: FocusQueueTask }) {
  const { data } = useItem(task.id);
  return data ? (
    <div className="mt-4">
      <Facts view={data} />
    </div>
  ) : null;
}

/** The readings the top bar shows, loaded once for every connector module's Status. */
interface StatusStore {
  readings: StatusReading[];
  fetchedAt: number | null;
  load: () => Promise<void>;
}

const FRESH_MS = 120_000;

const useStatusStore = create<StatusStore>()((set, get) => ({
  readings: [],
  fetchedAt: null,
  load: async () => {
    const { fetchedAt } = get();
    if (fetchedAt && Date.now() - fetchedAt < FRESH_MS) return;
    set({ fetchedAt: Date.now() });
    try {
      const res = await fetch("/api/connect/status");
      if (!res.ok) throw new Error(String(res.status));
      set({
        readings: ((await res.json()) as { readings: StatusReading[] })
          .readings,
      });
    } catch {
      set({ fetchedAt: null });
    }
  },
}));

/** One connector module's count in the status strip, when its "Show in the top bar" is on. */
export function ReadingStatus({ moduleId }: { moduleId: ModuleId }) {
  const pathname = usePathname();
  const reading = useStatusStore((s) =>
    s.readings.find((r) => r.module === moduleId)
  );
  const load = useStatusStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  if (!reading) return null;
  return (
    <span
      className="flex flex-none items-center gap-x-1.5"
      title={`${moduleById(moduleId).name}: ${reading.label}`}
    >
      <span aria-hidden>·</span>
      <span>
        {reading.label} {formatReading(reading.value, reading.unit)}
      </span>
    </span>
  );
}
