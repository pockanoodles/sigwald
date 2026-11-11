/**
 * Comma-separated values as spreadsheets publish them (RFC 4180): quoted
 * fields may hold commas, quotes ("" for one) and line breaks. Pure.
 */

/** The rows of a CSV, each a list of cells. A byte-order mark and a trailing newline are ignored. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Rows as records keyed by the first row's headers (trimmed, matched without case). */
export function csvRecords(text: string): {
  headers: string[];
  records: Record<string, string>[];
} {
  const [head, ...body] = parseCsv(text);
  const headers = (head ?? []).map((h) => h.trim());
  const records = body.map((cells) =>
    Object.fromEntries(
      headers.map((h, i) => [h.toLowerCase(), (cells[i] ?? "").trim()])
    )
  );
  return { headers, records };
}

const TRUTHY = new Set([
  "true",
  "yes",
  "y",
  "x",
  "done",
  "complete",
  "completed",
  "✓",
  "✔",
  "1",
]);

/** Whether a cell says "done" the way people write it in sheets. */
export function isTruthy(cell: string): boolean {
  return TRUTHY.has(cell.trim().toLowerCase());
}

/**
 * A day from a cell, as YYYY-MM-DD, in the order the sheet writes dates
 * ("ymd", "mdy" or "dmy"). Sheets often add a time; it's dropped. Null when
 * the cell isn't a real day.
 */
export function cellDay(
  cell: string,
  order: "ymd" | "mdy" | "dmy"
): string | null {
  const text = cell.trim();
  if (!text) return null;
  let y: number;
  let m: number;
  let d: number;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const slashed = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (slashed && order !== "ymd") {
    const [a, b, c] = [
      Number(slashed[1]),
      Number(slashed[2]),
      Number(slashed[3]),
    ];
    y = c < 100 ? 2000 + c : c;
    [m, d] = order === "mdy" ? [a, b] : [b, a];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
