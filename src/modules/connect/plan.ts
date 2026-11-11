/**
 * What a pull changes, worked out before anything is written. Pure: the
 * store (src/modules/connect/store.ts) hands it what Sigwald holds for a
 * module and what the pull saw, and writes the plan it gets back.
 *
 * Each thing a module reads is mirrored once (`ModuleItem`), and its task or
 * calendar event is a projection of that mirror, the way a Work shift is the
 * truth behind its calendar event. The rules:
 *
 * - Seen open: its task is kept in step (title, due, link, impact, claims).
 *   A task the source had closed opens again; one the source had finished
 *   opens again only if the source reopened it, never one finished by hand.
 * - Seen done: its task is finished, at the time the source finished it, so
 *   the goals that claim it earn for it.
 * - Not seen, when the pull saw everything: it has gone (closed without
 *   being done, unassigned, deleted), and its task is closed, which takes it
 *   out of every list without counting as done.
 * - New work gets a task only while fewer than the module's `maxOpen` are
 *   open; the rest wait their turn, in the order the pull gave them.
 * - A task deleted by hand stays deleted: the mirror remembers it had one.
 * - An event leaves the calendar when it's cancelled or gone, unless it's
 *   already over: a booking that happened stays where it was.
 */
import { endOfDayIn } from "@/lib/date-utils";

import {
  type Claim,
  type Fact,
  type PullResult,
  type PulledEvent,
  type PulledItem,
  type PulledReading,
  type PulledTask,
  isDueDay,
  isDueMoment,
} from "./pull";

export interface HeldTask {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  impact: number | null;
  duration: number | null;
  externalUrl: string | null;
  externalListId: string | null;
  claims: string[];
  status: string;
  completedAt: Date | null;
  closedAt: Date | null;
}

export interface HeldEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  transparency: string | null;
}

/** A mirrored item as Sigwald holds it, with its task or event. */
export interface HeldItem {
  id: string;
  externalId: string;
  kind: string;
  state: string;
  doneAt: Date | null;
  title: string;
  url: string | null;
  facts: unknown;
  group: string | null;
  upstreamUpdatedAt: Date | null;
  lastSeenAt: Date;
  /** When it first got a task. Set with no task means its task was deleted by hand. */
  projectedAt: Date | null;
  task: HeldTask | null;
  event: HeldEvent | null;
}

export type ItemState = "open" | "done" | "gone";

export interface ItemFields {
  kind: "task" | "event";
  title: string;
  url: string | null;
  state: ItemState;
  doneAt: Date | null;
  facts: Fact[];
  group: string | null;
  upstreamUpdatedAt: Date | null;
  lastSeenAt: Date;
}

/** The task columns a connector module owns. Everything else (schedule, project, priority) is the person's. */
export interface TaskFields {
  title: string;
  description: string | null;
  dueDate: Date | null;
  impact: number | null;
  duration: number | null;
  externalUrl: string | null;
  externalListId: string | null;
  claims: string[];
}

export type TaskChange = Partial<TaskFields> & {
  status?: "todo" | "completed";
  completedAt?: Date | null;
  closedAt?: Date | null;
};

export interface EventFields {
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  transparency: "OPAQUE" | "TRANSPARENT";
}

export interface ItemWrite {
  /** The held row, or null for something seen for the first time. */
  heldId: string | null;
  externalId: string;
  /** The item row's new fields (all of them for a new one); null when it's unchanged. */
  item: Partial<ItemFields> | null;
  task:
    | { kind: "create"; fields: TaskFields }
    | { kind: "update"; taskId: string; change: TaskChange }
    | null;
  event:
    | { kind: "put"; eventId: string | null; fields: EventFields }
    | { kind: "remove"; eventId: string }
    | null;
}

export interface PlanCounts {
  /** Things the pull saw. */
  seen: number;
  /** Tasks made. */
  created: number;
  /** Tasks the source finished. */
  finished: number;
  /** Things gone from the source. */
  gone: number;
  /** New work waiting for room under `maxOpen`. */
  waiting: number;
}

export interface Plan {
  writes: ItemWrite[];
  counts: PlanCounts;
}

export interface PlanInput {
  held: readonly HeldItem[];
  result: PullResult;
  now: Date;
  timeZone: string;
  maxOpen: number;
  /** Take events off the calendar once they're gone even if they're over (Golden hour's past days are noise). */
  removePastEvents?: boolean;
}

/** A seen item's mirror is written again at most this often when nothing else changed, to keep `lastSeenAt` fresh for pruning. */
const SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

export function planPull(input: PlanInput): Plan {
  const { now, timeZone, maxOpen } = input;
  const held = new Map(input.held.map((h) => [h.externalId, h]));
  const seen = new Set<string>();
  const writes: ItemWrite[] = [];
  const counts: PlanCounts = {
    seen: 0,
    created: 0,
    finished: 0,
    gone: 0,
    waiting: 0,
  };
  /** New work in the pull's order, waiting to see if there's room. */
  const candidates: { write: ItemWrite; fields: TaskFields }[] = [];
  /** Tasks that will be open once this plan is written, apart from new ones. */
  let open = 0;

  for (const pulled of input.result.items) {
    if (seen.has(pulled.externalId)) continue;
    seen.add(pulled.externalId);
    counts.seen += 1;
    const h = held.get(pulled.externalId) ?? null;
    // Something finished (or gone) before Sigwald ever saw it open isn't work it tracked.
    if (!h && pulled.state !== "open") continue;

    if (pulled.state === "gone" && h) {
      // Said of this one item: what a complete pull says of anything unlisted.
      if (h.state !== "gone") {
        counts.gone += 1;
        writes.push({
          heldId: h.id,
          externalId: h.externalId,
          item: { state: "gone" },
          task:
            h.task && h.task.status !== "completed" && !h.task.closedAt
              ? { kind: "update", taskId: h.task.id, change: { closedAt: now } }
              : null,
          event:
            h.event && (h.event.end > now || input.removePastEvents)
              ? { kind: "remove", eventId: h.event.id }
              : null,
        });
      }
      continue;
    }

    const sourceDoneAt = pulled.kind === "task" ? pulled.doneAt : null;
    // Done stays at the time first heard. A repeat (an Inbox item sent again,
    // a closed issue listed again) never moves it: its task's finish would no
    // longer match, and a reopen at the source couldn't undo the finish.
    const doneAt =
      pulled.state !== "done"
        ? null
        : h?.state === "done" && h.doneAt
          ? h.doneAt
          : (sourceDoneAt ?? h?.doneAt ?? now);
    const fields: ItemFields = {
      kind: pulled.kind,
      title: pulled.title,
      url: pulled.url ?? null,
      state: pulled.state,
      doneAt,
      facts: [...(pulled.facts ?? [])],
      group: pulled.kind === "task" ? (pulled.group?.key ?? null) : null,
      upstreamUpdatedAt: pulled.updatedAt ?? null,
      lastSeenAt: now,
    };
    // A done report only finishes: services often say no more than which
    // one and when, so it never restates the rest of the item or its task.
    const finishing = pulled.state === "done" && h !== null;
    const write: ItemWrite = {
      heldId: h?.id ?? null,
      externalId: pulled.externalId,
      item: finishing
        ? h.state === "done" && sameTime(h.doneAt, doneAt)
          ? null
          : { state: "done", doneAt, lastSeenAt: now }
        : h
          ? itemChange(h, fields, now)
          : fields,
      task: null,
      event: null,
    };

    if (pulled.kind === "task") {
      const taskFields = taskFieldsFor(pulled, timeZone);
      if (h?.task) {
        const change: TaskChange = finishing
          ? {}
          : taskChange(h.task, taskFields);
        if (pulled.state === "open") {
          if (h.task.closedAt) change.closedAt = null;
          const finishedBySource =
            h.task.status === "completed" &&
            h.doneAt !== null &&
            h.task.completedAt?.getTime() === h.doneAt.getTime();
          if (finishedBySource) {
            change.status = "todo";
            change.completedAt = null;
          }
        } else if (h.task.status !== "completed") {
          change.status = "completed";
          change.completedAt = doneAt;
          change.closedAt = null;
          counts.finished += 1;
        }
        if (Object.keys(change).length > 0) {
          write.task = { kind: "update", taskId: h.task.id, change };
        }
        if (taskWillBeOpen(h.task, change)) open += 1;
      } else if (!h?.projectedAt && pulled.state === "open") {
        candidates.push({ write, fields: taskFields });
      }
    } else {
      write.event = eventWrite(h, pulled, now);
    }

    writes.push(write);
  }

  if (input.result.complete) {
    for (const h of input.held) {
      if (seen.has(h.externalId) || h.state !== "open") continue;
      counts.gone += 1;
      const write: ItemWrite = {
        heldId: h.id,
        externalId: h.externalId,
        item: { state: "gone" },
        task: null,
        event: null,
      };
      if (h.task && h.task.status !== "completed" && !h.task.closedAt) {
        write.task = {
          kind: "update",
          taskId: h.task.id,
          change: { closedAt: now },
        };
      }
      if (h.event && (h.event.end > now || input.removePastEvents)) {
        write.event = { kind: "remove", eventId: h.event.id };
      }
      writes.push(write);
    }
  }

  // Held tasks not seen this time (a partial pull) still take their room.
  for (const h of input.held) {
    if (seen.has(h.externalId) || !h.task) continue;
    const goneNow = input.result.complete && h.state === "open";
    if (!goneNow && h.task.status !== "completed" && !h.task.closedAt)
      open += 1;
  }

  for (const { write, fields } of candidates) {
    if (open < maxOpen) {
      write.task = { kind: "create", fields };
      open += 1;
      counts.created += 1;
    } else {
      counts.waiting += 1;
    }
  }

  return {
    writes: writes.filter((w) => !w.heldId || w.item || w.task || w.event),
    counts,
  };
}

function taskWillBeOpen(task: HeldTask, change: TaskChange): boolean {
  const status = change.status ?? task.status;
  const closedAt = "closedAt" in change ? change.closedAt : task.closedAt;
  return status !== "completed" && !closedAt;
}

export function taskFieldsFor(
  pulled: PulledTask,
  timeZone: string
): TaskFields {
  const due = pulled.due
    ? "date" in pulled.due
      ? endOfDayIn(pulled.due.date, timeZone)
      : pulled.due.at
    : null;
  const claims = [
    ...(pulled.group ? [pulled.group.key] : []),
    ...(pulled.claims ?? []).map(claimKey),
  ];
  return {
    title: pulled.title,
    description: pulled.description ?? null,
    dueDate: due,
    impact: pulled.impact ?? null,
    duration: pulled.minutes ?? null,
    externalUrl: pulled.url ?? null,
    externalListId: pulled.group?.key ?? null,
    claims: [...new Set(claims)],
  };
}

export function claimKey(claim: Claim): string {
  return typeof claim === "string" ? claim : claim.key;
}

function sameTime(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function taskChange(task: HeldTask, fields: TaskFields): TaskChange {
  const change: TaskChange = {};
  if (task.title !== fields.title) change.title = fields.title;
  if (task.description !== fields.description)
    change.description = fields.description;
  if (!sameTime(task.dueDate, fields.dueDate)) change.dueDate = fields.dueDate;
  if (task.impact !== fields.impact) change.impact = fields.impact;
  if (task.duration !== fields.duration) change.duration = fields.duration;
  if (task.externalUrl !== fields.externalUrl)
    change.externalUrl = fields.externalUrl;
  if (task.externalListId !== fields.externalListId)
    change.externalListId = fields.externalListId;
  if (task.claims.join("\n") !== fields.claims.join("\n"))
    change.claims = fields.claims;
  return change;
}

function itemChange(
  h: HeldItem,
  fields: ItemFields,
  now: Date
): Partial<ItemFields> | null {
  const changed =
    h.kind !== fields.kind ||
    h.title !== fields.title ||
    h.url !== fields.url ||
    h.state !== fields.state ||
    !sameTime(h.doneAt, fields.doneAt) ||
    JSON.stringify(h.facts ?? []) !== JSON.stringify(fields.facts) ||
    h.group !== fields.group ||
    !sameTime(h.upstreamUpdatedAt, fields.upstreamUpdatedAt);
  if (changed) return fields;
  return now.getTime() - h.lastSeenAt.getTime() > SEEN_REFRESH_MS
    ? { lastSeenAt: now }
    : null;
}

export function eventFieldsFor(pulled: PulledEvent): EventFields {
  const description = [pulled.description, pulled.url]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: pulled.title,
    description: description || null,
    location: pulled.location ?? null,
    start: pulled.start,
    end: pulled.end,
    allDay: pulled.allDay ?? false,
    transparency: pulled.busy ? "OPAQUE" : "TRANSPARENT",
  };
}

function eventWrite(
  h: HeldItem | null,
  pulled: PulledEvent,
  now: Date
): ItemWrite["event"] {
  if (pulled.state === "done") {
    return h?.event && h.event.end > now
      ? { kind: "remove", eventId: h.event.id }
      : null;
  }
  const fields = eventFieldsFor(pulled);
  const e = h?.event;
  const same =
    e &&
    e.title === fields.title &&
    e.description === fields.description &&
    e.location === fields.location &&
    e.start.getTime() === fields.start.getTime() &&
    e.end.getTime() === fields.end.getTime() &&
    e.allDay === fields.allDay &&
    e.transparency === fields.transparency;
  return same ? null : { kind: "put", eventId: e?.id ?? null, fields };
}

// What a pull answers, made safe to write. Pulls are this codebase's own
// code, but each one reads a service's answer, so lengths, links and dates
// are checked once here rather than trusted in forty places.

const MAX_ITEMS = 1000;
const MAX_READINGS = 50;
const MAX_FACTS = 12;
const MAX_CLAIMS = 20;
const MAX_EVENT_MS = 31 * 24 * 60 * 60 * 1000;
const READING_KEY = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const UNIT = /^[a-z]{1,12}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function longText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function link(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function validDate(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function cleanFacts(value: unknown): Fact[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((f) => {
      const label = text(f?.label, 40);
      const v = text(f?.value, 200);
      return label && v ? [{ label, value: v }] : [];
    })
    .slice(0, MAX_FACTS);
}

function cleanItem(raw: PulledItem): PulledItem | null {
  const externalId = text(raw?.externalId, 300);
  const title = text(raw?.title, 300);
  if (!externalId || !title) return null;
  // An event that's gone is as good as cancelled: done takes it off the calendar.
  const state = raw.state === "done" || raw.state === "gone" ? "done" : "open";
  const base = {
    externalId,
    title,
    state,
    url: link(raw.url),
    description: longText(raw.description, 8000),
    facts: cleanFacts(raw.facts),
    updatedAt: validDate(raw.updatedAt),
  } as const;

  if (raw.kind === "event") {
    const start = validDate(raw.start);
    if (!start) return null;
    let end = validDate(raw.end) ?? new Date(start.getTime() + 30 * 60_000);
    if (end < start) end = new Date(start.getTime() + 30 * 60_000);
    if (end.getTime() - start.getTime() > MAX_EVENT_MS)
      end = new Date(start.getTime() + MAX_EVENT_MS);
    return {
      ...base,
      kind: "event",
      start,
      end,
      allDay: raw.allDay === true,
      busy: raw.busy === true,
      location: text(raw.location, 300),
    };
  }
  if (raw.kind !== "task") return null;

  // A due that isn't a real day or a plausible moment is dropped, never
  // turned into some other day.
  let due: PulledTask["due"] = null;
  if (raw.due && "date" in raw.due && isDueDay(raw.due.date)) {
    due = { date: raw.due.date };
  } else if (raw.due && "at" in raw.due && isDueMoment(raw.due.at)) {
    due = { at: raw.due.at };
  }
  const groupKey = text(raw.group?.key, 200);
  const minutes =
    typeof raw.minutes === "number" && Number.isFinite(raw.minutes)
      ? Math.min(24 * 60, Math.max(1, Math.round(raw.minutes)))
      : null;
  return {
    ...base,
    kind: "task",
    state: raw.state === "gone" ? "gone" : base.state,
    doneAt: validDate(raw.doneAt),
    due,
    impact:
      typeof raw.impact === "number" && Number.isFinite(raw.impact)
        ? Math.min(1, Math.max(0, raw.impact))
        : null,
    minutes,
    group: groupKey
      ? { key: groupKey, label: text(raw.group?.label, 100) ?? groupKey }
      : null,
    claims: cleanClaims(raw.claims),
  };
}

function cleanClaims(raw: unknown): Claim[] {
  if (!Array.isArray(raw)) return [];
  const out: Claim[] = [];
  const keys = new Set<string>();
  for (const c of raw) {
    const key = text(typeof c === "string" ? c : c?.key, 200);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    const label = typeof c === "string" ? null : text(c?.label, 100);
    out.push(label ? { key, label } : key);
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}

function cleanReading(raw: PulledReading): PulledReading | null {
  const key = typeof raw?.key === "string" ? raw.key.trim() : "";
  const label = text(raw?.label, 80);
  const unit =
    typeof raw?.unit === "string" ? raw.unit.trim().toLowerCase() : "";
  if (!READING_KEY.test(key) || !label || !UNIT.test(unit)) return null;
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return null;
  return { key, label, unit, value: raw.value };
}

/** A pull's answer with anything unusable dropped and everything else held to size. */
export function cleanResult(
  raw: PullResult
): PullResult & { readings: PulledReading[] } {
  const items: PulledItem[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(raw?.items) ? raw.items : []) {
    const item = cleanItem(entry);
    if (!item || ids.has(item.externalId)) continue;
    ids.add(item.externalId);
    items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  const readings: PulledReading[] = [];
  const keys = new Set<string>();
  for (const entry of Array.isArray(raw?.readings) ? raw.readings : []) {
    const reading = cleanReading(entry);
    if (!reading || keys.has(reading.key)) continue;
    keys.add(reading.key);
    readings.push(reading);
    if (readings.length >= MAX_READINGS) break;
  }
  return {
    items,
    // A capped answer may have left some out, so it can't vouch for the rest.
    complete: raw?.complete === true && items.length < MAX_ITEMS,
    readings,
    cursor: raw?.cursor,
  };
}

/** The claim groups among the items, and their other named claims, with labels, for the goal form. */
export function groupsOf(result: PullResult): Record<string, string> {
  const groups: Record<string, string> = {};
  for (const item of result.items) {
    if (item.kind !== "task") continue;
    if (item.group) groups[item.group.key] = item.group.label;
    for (const claim of item.claims ?? []) {
      if (typeof claim !== "string") groups[claim.key] = claim.label;
    }
  }
  return groups;
}
