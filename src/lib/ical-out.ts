import { createHash, randomBytes } from "node:crypto";

/** Fields of a scheduled task needed to emit a VEVENT. */
export interface PlanTask {
  id: string;
  title: string;
  description: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  updatedAt: Date;
}

/** Fields of a calendar event instance needed to emit a VEVENT. */
export interface PlanEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
}

/** 32 random bytes, base64url, plus the SHA-256 hex hash stored in the DB. */
export function newSubscriptionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** SHA-256 hex digest of a subscription token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Escape an iCalendar TEXT value: backslash, semicolon, comma, and newlines.
 * Order matters: backslashes first so later escapes aren't double-escaped.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n");
}

/**
 * Fold a content line so no physical line exceeds 75 octets (RFC 5545).
 * Continuation lines begin with a single SPACE.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const chars = [...line];
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of chars) {
    const chBytes = encoder.encode(ch).length;
    // First line budget is 75; continuations have a leading space so 74 of content.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + chBytes > limit && current.length > 0) {
      parts.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }

  return parts
    .map((part, i) => (i === 0 ? part : ` ${part}`))
    .join("\r\n");
}

function formatUtcDateTime(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

/**
 * An all-day date. All-day rows are stored at local midnight of the day
 * (`createAllDayDate` in lib/date-utils.ts), so the day is read from the local
 * fields: on a server east of UTC the UTC fields name the day before.
 */
function formatAllDayDate(date: Date): string {
  const y = date.getFullYear().toString().padStart(4, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function textProp(name: string, value: string): string {
  return foldLine(`${name}:${escapeText(value)}`);
}

function taskEvent(task: PlanTask, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    prop("UID", `task-${task.id}@sigwald`),
    textProp("SUMMARY", task.title),
    prop("DTSTART", formatUtcDateTime(task.scheduledStart)),
    prop("DTEND", formatUtcDateTime(task.scheduledEnd)),
  ];
  if (task.description) {
    lines.push(textProp("DESCRIPTION", task.description));
  }
  lines.push(
    prop("DTSTAMP", formatUtcDateTime(now)),
    prop("LAST-MODIFIED", formatUtcDateTime(task.updatedAt)),
    prop("CATEGORIES", "Sigwald task"),
    "END:VEVENT"
  );
  return lines;
}

function calendarEvent(event: PlanEvent, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    prop("UID", `event-${event.id}@sigwald`),
    textProp("SUMMARY", event.title),
  ];
  if (event.allDay) {
    lines.push(
      prop("DTSTART;VALUE=DATE", formatAllDayDate(event.start)),
      prop("DTEND;VALUE=DATE", formatAllDayDate(event.end))
    );
  } else {
    lines.push(
      prop("DTSTART", formatUtcDateTime(event.start)),
      prop("DTEND", formatUtcDateTime(event.end))
    );
  }
  if (event.description) {
    lines.push(textProp("DESCRIPTION", event.description));
  }
  if (event.location) {
    lines.push(textProp("LOCATION", event.location));
  }
  lines.push(prop("DTSTAMP", formatUtcDateTime(now)), "END:VEVENT");
  return lines;
}

/**
 * Build an RFC 5545 calendar of scheduled tasks and Sigwald-owned events.
 * Writes CRLF lines by hand; no iCalendar library.
 */
export function buildPlanCalendar(input: {
  tasks: PlanTask[];
  events: PlanEvent[];
  now: Date;
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sigwald//Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Sigwald",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const task of input.tasks) {
    lines.push(...taskEvent(task, input.now));
  }
  for (const event of input.events) {
    lines.push(...calendarEvent(event, input.now));
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
