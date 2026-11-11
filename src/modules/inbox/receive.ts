/**
 * What may be sent to the Inbox's private address, checked before any of it
 * is kept. Pure. One item, or `{ "items": [...] }` of up to 50:
 *
 *   {
 *     "title": "Send Mara the deck",        required
 *     "id": "crm-123",                       optional: send it again to update it
 *     "due": "2026-11-20",                   a day, or a moment with its offset
 *     "start": "…", "end": "…",              a time instead: it goes on the calendar
 *     "busy": true,                          for a time: blocks the scheduler (default)
 *     "url": "https://…", "note": "…",
 *     "minutes": 30,                         how long it takes
 *     "priority": "high",                    urgent | high | medium | low
 *     "list": "Clients",                     a group a goal can claim
 *     "done": true                           finishes what was sent with that id
 *   }
 *
 * Without an id, the same title, due, time and link make the same item, so
 * a retry never makes a second one.
 */
import { createHash } from "node:crypto";

import { type PulledItem, isDueDay, isDueMoment } from "@/modules/connect/pull";

export const MAX_ITEMS = 50;
export const MAX_BODY_BYTES = 64 * 1024;

const ID = /^[A-Za-z0-9:._-]{1,200}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const PRIORITY: Record<string, number> = {
  urgent: 0.9,
  high: 0.7,
  medium: 0.4,
  low: 0.15,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function moment(v: unknown, where: string): Date | string {
  if (typeof v !== "string" || !MOMENT.test(v))
    return `${where} must be a time with its offset, like 2026-11-20T15:00:00-05:00`;
  // A Date would quietly make 2026-02-31 March 3: the day must be real first.
  const at = new Date(v);
  return isDueDay(v.slice(0, 10)) && isDueMoment(at)
    ? at
    : `${where} isn't a real time`;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "list"
  );
}

function parseOne(raw: unknown, where: string, now: Date): PulledItem | string {
  if (!isRecord(raw)) return `${where} must be an object`;
  const title = str(raw.title);
  if (!title) return `${where}.title is needed`;
  if (title.length > 300) return `${where}.title is too long`;

  let id: string;
  if (raw.id !== undefined && raw.id !== null) {
    if (typeof raw.id !== "string" || !ID.test(raw.id))
      return `${where}.id may use letters, digits and : . _ - (up to 200)`;
    id = raw.id;
  } else {
    const basis = [title, raw.due, raw.start, raw.url]
      .map((v) => (typeof v === "string" ? v : ""))
      .join("\n");
    id = `auto:${createHash("sha256").update(basis).digest("hex").slice(0, 24)}`;
  }

  let url: string | null = null;
  if (raw.url !== undefined && raw.url !== null) {
    if (
      typeof raw.url !== "string" ||
      !/^https?:\/\/\S+$/.test(raw.url) ||
      raw.url.length > 2000
    ) {
      return `${where}.url must be a web address`;
    }
    url = raw.url;
  }
  const note =
    raw.note === undefined || raw.note === null
      ? null
      : typeof raw.note === "string"
        ? raw.note.slice(0, 8000)
        : undefined;
  if (note === undefined) return `${where}.note must be text`;
  const done = raw.done === true;
  if (raw.done !== undefined && typeof raw.done !== "boolean")
    return `${where}.done must be true or false`;

  if (raw.start !== undefined) {
    const start = moment(raw.start, `${where}.start`);
    if (typeof start === "string") return start;
    let end = new Date(start.getTime() + 30 * 60_000);
    if (raw.end !== undefined) {
      const e = moment(raw.end, `${where}.end`);
      if (typeof e === "string") return e;
      if (e <= start) return `${where}.end must be after start`;
      end = e;
    }
    if (raw.busy !== undefined && typeof raw.busy !== "boolean")
      return `${where}.busy must be true or false`;
    return {
      kind: "event",
      externalId: id,
      title,
      state: done ? "done" : "open",
      start,
      end,
      busy: raw.busy !== false,
      url,
      description: note,
    };
  }

  let due: { date: string } | { at: Date } | null = null;
  if (raw.due !== undefined && raw.due !== null) {
    if (typeof raw.due === "string" && DAY.test(raw.due)) {
      if (!isDueDay(raw.due)) return `${where}.due isn't a real day`;
      due = { date: raw.due };
    } else {
      const at = moment(raw.due, `${where}.due`);
      if (typeof at === "string")
        return `${where}.due must be a day (2026-11-20) or a time with its offset`;
      due = { at };
    }
  }
  let minutes: number | null = null;
  if (raw.minutes !== undefined && raw.minutes !== null) {
    if (
      typeof raw.minutes !== "number" ||
      !Number.isFinite(raw.minutes) ||
      raw.minutes < 1 ||
      raw.minutes > 1440
    ) {
      return `${where}.minutes must be from 1 to 1440`;
    }
    minutes = Math.round(raw.minutes);
  }
  let impact: number | null = null;
  if (raw.priority !== undefined && raw.priority !== null) {
    const p =
      typeof raw.priority === "string"
        ? PRIORITY[raw.priority.toLowerCase()]
        : undefined;
    if (p === undefined)
      return `${where}.priority must be urgent, high, medium or low`;
    impact = p;
  }
  const list = str(raw.list);
  if (list && list.length > 60) return `${where}.list is too long`;

  return {
    kind: "task",
    externalId: id,
    title,
    state: done ? "done" : "open",
    doneAt: done ? now : null,
    url,
    description: note,
    due,
    impact,
    minutes,
    group: list ? { key: `inbox:list:${slug(list)}`, label: list } : null,
  };
}

/** What was sent, as items, or what's wrong with it. */
export function parseInbox(
  raw: unknown,
  now: Date
): { items: PulledItem[] } | { problem: string } {
  const list = isRecord(raw) && Array.isArray(raw.items) ? raw.items : [raw];
  if (list.length === 0) return { problem: "Send at least one item" };
  if (list.length > MAX_ITEMS)
    return { problem: `Send at most ${MAX_ITEMS} items at a time` };
  const items: PulledItem[] = [];
  const ids = new Set<string>();
  for (const [i, entry] of list.entries()) {
    const item = parseOne(
      entry,
      list.length === 1 && !isRecord(raw) ? "item" : `items[${i}]`,
      now
    );
    if (typeof item === "string") return { problem: item };
    if (ids.has(item.externalId))
      return { problem: `items[${i}] repeats id ${item.externalId}` };
    ids.add(item.externalId);
    items.push(item);
  }
  return { items };
}
