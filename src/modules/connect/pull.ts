/**
 * The contract between a connector module and the framework: a pull reads
 * what the service holds now and says it in Sigwald's words, and the
 * framework does the rest (src/modules/connect/plan.ts).
 *
 * A pull never touches the database. It's handed an `Http` that can reach
 * only its service, the connection's fields and its settings, and it answers
 * with what it saw: work (tasks), times (events) and numbers (readings).
 * That keeps each module a mapping that a test can run against a recorded
 * answer, and keeps every write in one place.
 */
import type { Http } from "@/lib/connectors/egress";

import type { Settings } from "./spec";

export interface PullContext {
  /** Reaches only the module's service (src/lib/connectors/egress.ts). */
  http: Http;
  /** The connection's secret fields (a token). Empty for a service with none. */
  secret: Readonly<Record<string, string>>;
  /** The connection's other fields, and what checking it learned (the account's id). */
  config: Readonly<Record<string, string>>;
  settings: Settings;
  now: Date;
  /** The person's zone, for days. */
  timeZone: string;
  /** What the last pull left for this one. */
  cursor: unknown;
  /** What Sigwald holds open from it now, so a pull that can't list everything can ask after these. */
  open: readonly {
    externalId: string;
    kind: "task" | "event";
    title: string;
  }[];
  /** When a pull last worked, to ask only what changed since. Null the first time. */
  lastSuccessAt: Date | null;
}

/** When a task is due: a whole day (due by its end, in the person's zone) or a moment. */
export type Due = { date: string } | { at: Date };

/** A key a goal can claim a task by, named when the goal form should offer it ("Linear project: Launch"). */
export type Claim = string | { key: string; label: string };

/** One line in an item's pane: "Repo · pockanoodles/sigwald". */
export interface Fact {
  label: string;
  value: string;
}

export interface PulledTask {
  kind: "task";
  /** Stable across pulls: the service's own id for it. */
  externalId: string;
  title: string;
  /**
   * Open is work to do; done finishes its task (and earns what finished work
   * earns). A done item needs only its id, a title and `doneAt`: it never
   * changes the rest of what's held.
   */
  state: "open" | "done";
  doneAt?: Date | null;
  url?: string | null;
  /** Plain text or Markdown. */
  description?: string | null;
  due?: Due | null;
  /** How much it matters, 0 to 1 (an urgent ticket 0.9, a low one 0.15). Null when the service doesn't say. */
  impact?: number | null;
  /** How long it takes, when the service knows (a reading time). */
  minutes?: number | null;
  /** The group it files under (a repo, a team), which a goal can claim whole. */
  group?: { key: string; label: string } | null;
  /** More keys a goal can claim it by; one with a label is offered in the goal form too. */
  claims?: readonly Claim[];
  facts?: readonly Fact[];
  updatedAt?: Date | null;
}

export interface PulledEvent {
  kind: "event";
  externalId: string;
  title: string;
  /** Open puts it on the calendar; done (cancelled, or over) takes it off. */
  state: "open" | "done";
  start: Date;
  end: Date;
  allDay?: boolean;
  /** Busy blocks the time for the scheduler (a booking); free leaves it (a holiday, golden hour). */
  busy: boolean;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  facts?: readonly Fact[];
  updatedAt?: Date | null;
}

export type PulledItem = PulledTask | PulledEvent;

/**
 * A number, as it stands today. Units: "count", "percent", "hours",
 * "minutes", or a currency's lowercase ISO code ("usd") for money, in whole
 * units (dollars, not cents).
 */
export interface PulledReading {
  key: string;
  label: string;
  value: number;
  unit: string;
}

export interface PullResult {
  items: readonly PulledItem[];
  /**
   * The items are everything open there now: anything Sigwald holds open
   * that isn't among them has gone (closed without being done, unassigned,
   * deleted). Leave it false when the pull may have missed some (it hit a
   * page cap, or one of its reads failed): then nothing is marked gone.
   */
  complete: boolean;
  readings?: readonly PulledReading[];
  /** Handed to the next pull. */
  cursor?: unknown;
}

export type PullFn = (ctx: PullContext) => Promise<PullResult>;

// Helpers pulls share.

/** 0–1, or null for anything that isn't a number. */
export function clampImpact(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A due from a service's date ("2026-11-20", or a date-time whose day is what matters). */
export function dueDay(value: string | null | undefined): Due | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return DAY.test(day) ? { date: day } : null;
}

/** A due from a service's moment (an ISO time with its offset, or epoch seconds/ms). */
export function dueAt(value: string | number | null | undefined): Due | null {
  const at = toDate(value);
  return at ? { at } : null;
}

/** A Date from an ISO string or an epoch (seconds when it's small, ms otherwise), or null. */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    typeof value === "number"
      ? new Date(value < 1e11 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Text with markup taken out and whitespace tidied, for a description. */
export function plainText(
  html: string | null | undefined,
  max = 4000
): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A fact, or nothing when there's no value to show. */
export function fact(
  label: string,
  value: string | number | null | undefined
): Fact[] {
  if (value === null || value === undefined || value === "") return [];
  return [{ label, value: String(value) }];
}

/**
 * What labels or a priority name say about how much something matters, if
 * they say anything: "P0", "urgent", "Highest" are 0.9, "high" 0.7,
 * "medium" 0.4, "low" 0.15. `fallback` when nothing matches.
 */
export function impactFromLabels(
  labels: readonly string[],
  fallback: number | null = null
): number | null {
  const text = labels.join(" ").toLowerCase();
  if (
    /\b(p0|sev[- ]?0|sev[- ]?1|critical|urgent|blocker|highest|security)\b/.test(
      text
    )
  ) {
    return 0.9;
  }
  if (/\b(p1|high|important|priority)\b/.test(text)) return 0.7;
  if (/\b(p2|medium|normal)\b/.test(text)) return 0.4;
  if (/\b(p3|p4|low|lowest|minor|nice[- ]to[- ]have|someday)\b/.test(text)) {
    return 0.15;
  }
  return fallback;
}
