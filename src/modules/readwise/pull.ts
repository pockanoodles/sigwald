/**
 * Readwise Reader's pull: documents in Later (and Shortlist) become "Read"
 * tasks sized by reading time. Reader has no "finished" query, but an
 * archived document is one you have read, so for the tasks Sigwald holds
 * that left the lists, the archive is searched for documents updated since
 * the last pull. Highlights and notes (child documents) are skipped.
 */
import {
  type ReaderDocument,
  listDocuments,
} from "@/lib/connectors/readwise/client";

import {
  type Fact,
  type PullFn,
  type PulledReading,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const FIRST_LOOKBACK_DAYS = 7;
const WORDS_PER_MINUTE = 238;

const PLACES = {
  later: { key: "readwise:location:later", label: "Reader: Later" },
  shortlist: {
    key: "readwise:location:shortlist",
    label: "Reader: Shortlist",
  },
} as const;

/** Minutes from "4 mins" (or a number), else from the word count, else null. */
export function minutesOf(doc: ReaderDocument): number | null {
  const raw = doc.reading_time;
  const fromText =
    typeof raw === "number" ? raw : Number(String(raw ?? "").match(/\d+/)?.[0]);
  if (Number.isFinite(fromText) && fromText > 0) return fromText;
  if (doc.word_count && doc.word_count > 0) {
    return Math.max(1, Math.ceil(doc.word_count / WORDS_PER_MINUTE));
  }
  return null;
}

function isDocument(doc: ReaderDocument): boolean {
  return (
    !doc.parent_id && doc.category !== "highlight" && doc.category !== "note"
  );
}

function toTask(
  doc: ReaderDocument,
  place: (typeof PLACES)[keyof typeof PLACES]
): PulledTask {
  const facts: Fact[] = [
    ...fact("Author", doc.author),
    ...fact("Site", doc.site_name),
    ...fact("Type", doc.category),
  ];
  return {
    kind: "task",
    externalId: doc.id,
    title: `Read: ${doc.title?.trim() || "Untitled"}`,
    state: "open",
    url: doc.source_url || doc.url || null,
    minutes: minutesOf(doc),
    group: place,
    facts,
    updatedAt: toDate(doc.updated_at),
  };
}

export const pullReadwise: PullFn = async (ctx) => {
  const { http, secret, settings, now } = ctx;
  let complete = true;
  const open = new Map<string, PulledTask>();
  const readings: PulledReading[] = [];

  const later = await listDocuments(http, secret, "later");
  if (!later.complete) complete = false;
  for (const doc of later.documents.filter(isDocument)) {
    open.set(doc.id, toTask(doc, PLACES.later));
  }
  // Reader's own count is the whole of Later even when only some pages were read.
  readings.push({
    key: "later",
    label: "Waiting in Later",
    value: later.count,
    unit: "count",
  });

  if (setting.on(settings, "shortlist")) {
    const shortlist = await listDocuments(http, secret, "shortlist");
    if (!shortlist.complete) complete = false;
    for (const doc of shortlist.documents.filter(isDocument)) {
      // A document is in one place, but if both lists name it Later wins.
      if (!open.has(doc.id)) open.set(doc.id, toTask(doc, PLACES.shortlist));
    }
  }

  const titles = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !open.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (titles.size > 0) {
    const since =
      ctx.lastSuccessAt ??
      new Date(now.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
    const archived = await listDocuments(http, secret, "archive", {
      updatedAfter: since,
      maxPages: 3,
    });
    if (!archived.complete) complete = false;
    for (const doc of archived.documents) {
      const title = titles.get(doc.id);
      if (title === undefined) continue;
      finished.push({
        kind: "task",
        externalId: doc.id,
        title,
        state: "done",
        doneAt: toDate(doc.updated_at) ?? now,
      });
    }
  }

  return { items: [...open.values(), ...finished], complete, readings };
};
