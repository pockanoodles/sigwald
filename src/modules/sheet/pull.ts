/**
 * Spreadsheet's pull: reads the published CSV through the egress, and makes
 * a task per row from the columns named in its settings. A row is keyed by
 * its ID column when there is one, else by its title and due, so editing
 * other cells keeps it the same task.
 */
import { createHash } from "node:crypto";

import { ConnectorError } from "@/lib/connectors/errors";

import { type PullFn, type PulledTask, fact } from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

import { cellDay, csvRecords, isTruthy } from "./csv";

const MAX_ROWS = 2000;

export const pullSheet: PullFn = async ({ http, settings }) => {
  const link = setting.text(settings, "link");
  const col = (k: string) => setting.text(settings, k).trim().toLowerCase();
  const [titleCol, dueCol, doneCol, urlCol, noteCol, idCol] = [
    "title",
    "due",
    "done",
    "url",
    "note",
    "id",
  ].map(col);
  const order = (setting.text(settings, "dates") || "ymd") as
    | "ymd"
    | "mdy"
    | "dmy";

  const { headers, records } = csvRecords(await http.text(link));
  const known = new Set(headers.map((h) => h.toLowerCase()));
  const missing = [titleCol, dueCol, doneCol, urlCol, noteCol, idCol].filter(
    (c) => c && !known.has(c)
  );
  if (missing.length > 0) {
    throw new ConnectorError(
      "config",
      `The sheet has no column called ${missing.join(", ")}. Its columns: ${headers.slice(0, 12).join(", ")}`
    );
  }

  const items: PulledTask[] = [];
  const seen = new Set<string>();
  for (const row of records.slice(0, MAX_ROWS)) {
    const title = row[titleCol];
    if (!title) continue;
    const day = dueCol ? cellDay(row[dueCol] ?? "", order) : null;
    const basis =
      idCol && row[idCol] ? `id:${row[idCol]}` : `row:${title}\n${day ?? ""}`;
    let externalId = createHash("sha256")
      .update(basis)
      .digest("hex")
      .slice(0, 24);
    // Two rows alike in title and due are still two tasks.
    for (let n = 2; seen.has(externalId); n++) {
      externalId = createHash("sha256")
        .update(`${basis}\n${n}`)
        .digest("hex")
        .slice(0, 24);
    }
    seen.add(externalId);
    const url =
      urlCol && /^https?:\/\//.test(row[urlCol] ?? "") ? row[urlCol] : null;
    items.push({
      kind: "task",
      externalId,
      title,
      state: doneCol && isTruthy(row[doneCol] ?? "") ? "done" : "open",
      doneAt: null,
      url,
      description: noteCol ? row[noteCol] || null : null,
      due: day ? { date: day } : null,
      facts: [
        ...fact("Due cell", dueCol ? row[dueCol] : null),
        ...fact("Row id", idCol ? row[idCol] : null),
      ],
    });
  }
  return { items, complete: records.length <= MAX_ROWS };
};
