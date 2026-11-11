/**
 * Airtable's pull: one table's records (up to 500) as tasks. The title,
 * due and done fields are named in settings. A ticked done checkbox
 * finishes a task Sigwald holds open; Airtable leaves an unticked box out
 * of a record, so a missing done field means open.
 */
import { listRecords } from "@/lib/connectors/airtable/client";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  dueDay,
  fact,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

export const pullAirtable: PullFn = async (ctx) => {
  const { http, secret, settings, now } = ctx;
  const base = setting.text(settings, "base");
  const table = setting.text(settings, "table");
  const titleField = setting.text(settings, "titleField");
  const dueField = setting.text(settings, "dueField");
  const doneField = setting.text(settings, "doneField");
  const held = new Map(ctx.open.map((o) => [o.externalId, o.title]));

  const found = await listRecords(
    http,
    secret,
    base,
    table,
    setting.text(settings, "view")
  );
  const items: PulledTask[] = [];
  for (const record of found.records) {
    const due = dueField ? text(record.fields[dueField]) : "";
    const task: PulledTask = {
      kind: "task",
      externalId: record.id,
      title: text(record.fields[titleField]) || "Untitled",
      state: "open",
      url: `https://airtable.com/${base}/${table}/${record.id}`,
      due: due ? (due.length <= 10 ? dueDay(due) : dueAt(due)) : null,
      group: {
        key: `airtable:table:${base}/${table}`.toLowerCase(),
        label: table,
      },
      facts: [...fact("Table", table)],
      updatedAt: null,
    };
    if (!doneField || record.fields[doneField] !== true) {
      items.push(task);
      continue;
    }
    const title = held.get(record.id);
    if (title === undefined) continue;
    // Airtable doesn't say when a box was ticked; this is when Sigwald saw it.
    items.push({ ...task, title, state: "done", doneAt: now });
  }
  return { items, complete: found.complete };
};
