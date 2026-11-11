/**
 * Pipedrive's pull: your activities that aren't done, plus the held ones
 * that are marked done now (asked for by id), so finishing one in Pipedrive
 * finishes its task. The names of the deal, person and organization come
 * from three small reads and are shown as facts; if one fails, the facts
 * are left out and nothing else changes.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  type PipedriveActivity,
  doneAmong,
  namesOf,
  undoneActivities,
} from "@/lib/connectors/pipedrive/client";

import {
  type Due,
  type PullFn,
  type PulledTask,
  dueDay,
  fact,
  plainText,
  toDate,
} from "@/modules/connect/pull";

/** "01:30:00" as minutes, or null. */
export function minutesOf(duration: string | null | undefined): number | null {
  const m = /^(\d+):(\d{2})(?::\d{2})?$/.exec(duration ?? "");
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes > 0 ? minutes : null;
}

/** A date-only due is a day; with a time (UTC) it is a moment. */
export function dueOf(a: {
  due_date: string | null;
  due_time: string | null;
}): Due | null {
  const day = dueDay(a.due_date);
  if (!day || !("date" in day)) return null;
  if (!a.due_time) return day;
  const at = toDate(`${day.date}T${a.due_time.slice(0, 8)}Z`);
  return at ? { at } : day;
}

function typeLabel(type: string | null): string {
  if (!type) return "";
  const text = type.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Names {
  deals: Map<number, string>;
  persons: Map<number, string>;
  organizations: Map<number, string>;
}

export function toTask(a: PipedriveActivity, names: Names): PulledTask {
  const subject = a.subject?.trim() || "Untitled activity";
  const label = typeLabel(a.type);
  const deal = a.deal_id ? names.deals.get(a.deal_id) : undefined;
  return {
    kind: "task",
    externalId: String(a.id),
    title: label ? `${label}: ${subject}` : subject,
    state: "open",
    description: plainText(a.note),
    due: dueOf(a),
    minutes: minutesOf(a.duration),
    group: deal
      ? { key: `pipedrive:deal:${a.deal_id}`, label: deal }
      : { key: "pipedrive:activities", label: "Pipedrive activities" },
    facts: [
      ...fact("Type", label),
      ...fact("Deal", deal),
      ...fact("Person", a.person_id ? names.persons.get(a.person_id) : null),
      ...fact(
        "Organization",
        a.org_id ? names.organizations.get(a.org_id) : null
      ),
    ],
    updatedAt: toDate(a.update_time),
  };
}

function distinct(values: (number | null)[]): number[] {
  return [...new Set(values.filter((v): v is number => typeof v === "number"))];
}

export const pullPipedrive: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const userId = config.userId;
  if (!userId) return { items: [], complete: false };

  const { activities, complete } = await undoneActivities(http, secret, userId);

  const names: Names = {
    deals: new Map(),
    persons: new Map(),
    organizations: new Map(),
  };
  const wanted: [keyof Names, number[]][] = [
    ["deals", distinct(activities.map((a) => a.deal_id))],
    ["persons", distinct(activities.map((a) => a.person_id))],
    ["organizations", distinct(activities.map((a) => a.org_id))],
  ];
  for (const [kind, ids] of wanted) {
    try {
      names[kind] = await namesOf(http, secret, kind, ids);
    } catch (error) {
      if (!isConnectorError(error)) throw error;
    }
  }

  const open = activities.map((a) => toTask(a, names));
  const seen = new Set(open.map((t) => t.externalId));
  const missing = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !seen.has(o.externalId))
      .slice(0, 100)
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  for (const a of await doneAmong(http, secret, [...missing.keys()])) {
    const title = missing.get(String(a.id));
    if (title === undefined) continue;
    finished.push({
      kind: "task",
      externalId: String(a.id),
      title,
      state: "done",
      doneAt: toDate(a.marked_as_done_time) ?? now,
    });
  }
  return { items: [...open, ...finished], complete };
};
