/**
 * What the connect API hands the browser, and the catalog helpers both
 * sides use. Plain data: no secret ever appears in these shapes.
 */
import type { ServiceManifest } from "@/lib/connectors/types";

import { MODULES } from "@/modules";
import type { ModuleId, ModuleManifest } from "@/modules/types";

import type { Fact } from "./pull";
import type { Settings } from "./spec";

export interface ConnectionView {
  service: string;
  /** Who Sigwald reads as. */
  accountLabel: string | null;
  /** Why the service last refused it; pulls wait until it's connected again. */
  error: string | null;
  verifiedAt: string | null;
  /** The connect form's non-secret fields as saved (a site address), to fill the form again. */
  fields: Record<string, string>;
}

export interface ItemView {
  id: string;
  title: string;
  url: string | null;
  kind: "task" | "event";
  state: "open" | "done" | "gone";
  /** Its task, if it has one (open work over `maxOpen` waits without one). */
  taskId: string | null;
  /** When its task is due, or its event starts. */
  when: string | null;
  doneAt: string | null;
}

export interface ReadingView {
  key: string;
  label: string;
  unit: string;
  value: number;
  /** When it was read. */
  at: string;
  /** The value a week before, when there's one to compare with. */
  weekAgo: number | null;
}

export interface ModuleConnectState {
  module: ModuleId;
  /** Its service's connection; null when it has none yet, or needs none. */
  connection: ConnectionView | null;
  settings: Settings;
  /** Required settings still empty. */
  missing: string[];
  lastPullAt: string | null;
  lastSuccessAt: string | null;
  /** When the next pull is due, unless something blocks it. */
  nextPullAt: string | null;
  error: string | null;
  counts: {
    open: number;
    waiting: number;
    finishedThisWeek: number;
    upcoming: number;
  };
  items: ItemView[];
  readings: ReadingView[];
}

/** One item's pane, for a task that came from a connector module. */
export interface ItemPaneView {
  module: ModuleId;
  title: string;
  url: string | null;
  state: "open" | "done" | "gone";
  facts: Fact[];
  /** When the service last changed it. */
  updatedAt: string | null;
  /** When Sigwald last saw it there. */
  seenAt: string;
}

/** A module's headline reading, for its count in the status strip. */
export interface StatusReading {
  module: ModuleId;
  label: string;
  unit: string;
  value: number;
}

/** Every service some module reads through, once each, in catalog order. */
export function servicesInUse(): ServiceManifest[] {
  const seen = new Map<string, ServiceManifest>();
  for (const m of MODULES) {
    const service = m.connect?.service;
    if (service && !seen.has(service.id)) seen.set(service.id, service);
  }
  return [...seen.values()];
}

export function serviceInUse(id: string): ServiceManifest | undefined {
  return servicesInUse().find((s) => s.id === id);
}

/** The modules that read through a service. */
export function modulesUsing(serviceId: string): ModuleManifest[] {
  return MODULES.filter((m) => m.connect?.service?.id === serviceId);
}

/** A reading as a person reads it: "$4,210", "1,204", "12.5 h", "38%". */
export function formatReading(
  value: number,
  unit: string,
  locale?: string
): string {
  const n = (digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
      value
    );
  switch (unit) {
    case "count":
      return n(Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0);
    case "percent":
      return `${n(1)}%`;
    case "hours":
      return `${n(1)} h`;
    case "minutes":
      return `${n(0)} min`;
    case "celsius":
      return `${n(0)}°C`;
    case "fahrenheit":
      return `${n(0)}°F`;
    default:
      if (/^[a-z]{3}$/.test(unit)) {
        try {
          return new Intl.NumberFormat(locale, {
            style: "currency",
            currency: unit.toUpperCase(),
            maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
          }).format(value);
        } catch {
          return `${n(2)} ${unit.toUpperCase()}`;
        }
      }
      return `${n(2)} ${unit}`;
  }
}
