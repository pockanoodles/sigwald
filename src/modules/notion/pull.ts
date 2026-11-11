/**
 * Notion's pull: each named database's rows (up to 300 each) as tasks. A
 * row is done when its status or select is one of the done values, or its
 * checkbox is ticked; a done row only matters as a finish for work Sigwald
 * holds open. A database the integration can't see is skipped, and the pull
 * says it wasn't complete.
 */
import { fromZonedTime } from "date-fns-tz";

import {
  type NotionDatabase,
  type NotionPage,
  type NotionProperty,
  type NotionValue,
  getDatabase,
  queryRows,
} from "@/lib/connectors/notion/client";

import {
  type Due,
  type PullFn,
  type PulledTask,
  dueAt,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

/** The 32 hex characters of a database's id, from its address, its id or the id with dashes. */
export function databaseId(input: string): string | null {
  const path = input.trim().split(/[?#]/)[0];
  const flat = path.replace(
    /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/gi,
    "$1$2$3$4$5"
  );
  const all = flat.match(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi);
  return all ? all[all.length - 1].toLowerCase() : null;
}

function plain(rich: { plain_text: string }[] | undefined): string {
  return (rich ?? [])
    .map((r) => r.plain_text)
    .join("")
    .trim();
}

function pick(
  props: Record<string, NotionProperty>,
  name: string,
  types: readonly string[]
): NotionProperty | null {
  const all = Object.values(props);
  if (name) {
    const wanted = name.toLowerCase();
    return all.find((p) => p.name.toLowerCase() === wanted) ?? null;
  }
  for (const type of types) {
    const found = all.find((p) => p.type === type);
    if (found) return found;
  }
  return null;
}

function dueOf(value: NotionValue | undefined): Due | null {
  const date = value?.date;
  if (!date?.start) return null;
  if (date.start.length <= 10) return dueDay(date.start);
  if (/(Z|[+-]\d{2}:\d{2})$/.test(date.start)) return dueAt(date.start);
  // A time with no offset is on the clock of its time_zone, when it names one.
  if (!date.time_zone) return dueAt(date.start);
  const at = fromZonedTime(date.start, date.time_zone);
  return Number.isNaN(at.getTime()) ? null : { at };
}

function isDone(value: NotionValue | undefined, done: string[]): boolean {
  if (!value) return false;
  if (value.type === "checkbox") return value.checkbox === true;
  const name = (value.status ?? value.select)?.name?.toLowerCase();
  return name !== undefined && done.includes(name);
}

function rowTask(
  page: NotionPage,
  db: NotionDatabase,
  dbId: string,
  dateProp: NotionProperty | null,
  doneProp: NotionProperty | null
): PulledTask | null {
  const titleProp = Object.values(db.properties).find(
    (p) => p.type === "title"
  );
  const title = titleProp ? plain(page.properties[titleProp.name]?.title) : "";
  const label = plain(db.title) || "Notion database";
  const status = doneProp ? page.properties[doneProp.name] : undefined;
  return {
    kind: "task",
    externalId: page.id,
    title: title || "Untitled",
    state: "open",
    url: page.url ?? null,
    due: dateProp ? dueOf(page.properties[dateProp.name]) : null,
    group: { key: `notion:db:${dbId}`, label },
    facts: [
      ...fact("Database", label),
      ...fact(
        "Status",
        status?.type === "checkbox"
          ? null
          : (status?.status ?? status?.select)?.name
      ),
    ],
    updatedAt: toDate(page.last_edited_time),
  };
}

export const pullNotion: PullFn = async (ctx) => {
  const { http, secret, settings, now } = ctx;
  const ids = [
    ...new Set(
      setting
        .list(settings, "databases")
        .map(databaseId)
        .filter((id): id is string => id !== null)
    ),
  ];
  const done = setting.list(settings, "done").map((v) => v.toLowerCase());
  const dateName = setting.text(settings, "dateProperty");
  const statusName = setting.text(settings, "statusProperty");
  const held = new Map(ctx.open.map((o) => [o.externalId, o.title]));

  let complete = true;
  const items: PulledTask[] = [];
  for (const id of ids) {
    const db = await getDatabase(http, secret, id);
    if (!db) {
      complete = false;
      continue;
    }
    const dateProp = pick(db.properties, dateName, ["date"]);
    const doneProp = pick(db.properties, statusName, ["status", "checkbox"]);
    const found = await queryRows(http, secret, id);
    if (!found.complete) complete = false;
    for (const page of found.rows) {
      const task = rowTask(page, db, id, dateProp, doneProp);
      if (!task) continue;
      const mark = doneProp ? page.properties[doneProp.name] : undefined;
      if (!isDone(mark, done)) {
        items.push(task);
        continue;
      }
      const title = held.get(page.id);
      if (title === undefined) continue;
      items.push({
        ...task,
        title,
        state: "done",
        doneAt: toDate(page.last_edited_time) ?? now,
      });
    }
  }
  return { items, complete };
};
