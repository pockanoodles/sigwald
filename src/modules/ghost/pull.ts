/**
 * Ghost's pull: drafts as tasks, scheduled posts as free calendar events at
 * their publish time, a draft that has been published since as done, and the
 * member total as a reading.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  memberTotal,
  postsWith,
  publishedAmong,
} from "@/lib/connectors/ghost/client";

import {
  type PullFn,
  type PulledEvent,
  type PulledReading,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";

/** Held drafts asked after by id in one pull, at most. */
const MAX_ASKED = 100;
const SLOT_MS = 15 * 60_000;

export const pullGhost: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const auth = { secret, config };
  const site = config.site;
  const label = config.title || new URL(site).hostname;
  const group = {
    key: `ghost:site:${new URL(site).hostname.toLowerCase()}`,
    label,
  };
  const editor = (id: string) => `${site}/ghost/#/editor/post/${id}`;

  const drafts = await postsWith(http, auth, "status:draft");
  const scheduled = await postsWith(
    http,
    auth,
    "status:scheduled",
    "published_at asc"
  );

  const tasks: PulledTask[] = drafts.posts.map((p) => ({
    kind: "task",
    externalId: p.id,
    title: `Finish: ${p.title || "Untitled"}`,
    state: "open",
    url: editor(p.id),
    group,
    facts: [...fact("Status", "Draft"), ...fact("Site", label)],
    updatedAt: toDate(p.updated_at),
  }));

  const events: PulledEvent[] = scheduled.posts.flatMap((p) => {
    const start = toDate(p.published_at);
    if (!start) return [];
    return [
      {
        kind: "event",
        externalId: `scheduled:${p.id}`,
        title: `Publishes: ${p.title || "Untitled"}`,
        state: "open",
        start,
        end: new Date(start.getTime() + SLOT_MS),
        busy: false,
        url: editor(p.id),
        facts: [...fact("Site", label)],
        updatedAt: toDate(p.updated_at),
      },
    ];
  });

  // A draft Sigwald holds that is no longer a draft has been written:
  // scheduled or published, its Finish task is done.
  const listed = new Set(tasks.map((t) => t.externalId));
  const held = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !listed.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  for (const p of scheduled.posts) {
    const title = held.get(p.id);
    if (title === undefined) continue;
    held.delete(p.id);
    finished.push({
      kind: "task",
      externalId: p.id,
      title,
      state: "done",
      doneAt: toDate(p.updated_at) ?? now,
    });
  }
  const asked = [...held.keys()].slice(0, MAX_ASKED);
  for (const p of await publishedAmong(http, auth, asked)) {
    finished.push({
      kind: "task",
      externalId: p.id,
      title: held.get(p.id) ?? `Finish: ${p.title}`,
      state: "done",
      doneAt: toDate(p.published_at) ?? now,
    });
  }

  const readings: PulledReading[] = [];
  try {
    const total = await memberTotal(http, auth);
    if (total !== null) {
      readings.push({
        key: "members",
        label: "Members",
        value: total,
        unit: "count",
      });
    }
  } catch (error) {
    // A key without member access still gets its drafts.
    if (
      !isConnectorError(error) ||
      (error.kind !== "forbidden" && error.kind !== "not_found")
    ) {
      throw error;
    }
  }

  return {
    items: [...tasks, ...events, ...finished],
    complete: drafts.complete && scheduled.complete && held.size <= MAX_ASKED,
    readings,
  };
};
