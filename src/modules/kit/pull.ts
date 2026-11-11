/**
 * Kit's pull: draft broadcasts as tasks, scheduled ones as free calendar
 * events at their send time, a held draft that has been sent since as done,
 * and the active subscribers as a reading. Everything here a v4 API key can
 * read; nothing needs OAuth.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import { activeSubscribers, broadcastsWith } from "@/lib/connectors/kit/client";

import {
  type PullFn,
  type PulledEvent,
  type PulledReading,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";

const SLOT_MS = 15 * 60_000;
const FIRST_LOOKBACK_MS = 7 * 86_400_000;

const subject = (s: string | null) => s?.trim() || "Untitled broadcast";

export const pullKit: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const name = config.name || "Kit";
  const group = {
    key: `kit:account:${(config.accountId || "main").toLowerCase()}`,
    label: name,
  };

  const drafts = await broadcastsWith(http, secret, "draft");
  const scheduled = await broadcastsWith(http, secret, "scheduled");

  const tasks: PulledTask[] = drafts.broadcasts.map((b) => ({
    kind: "task",
    externalId: String(b.id),
    title: `Finish: ${subject(b.subject)}`,
    state: "open",
    group,
    facts: [...fact("Status", "Draft"), ...fact("Account", name)],
    updatedAt: toDate(b.created_at),
  }));

  const events: PulledEvent[] = scheduled.broadcasts.flatMap((b) => {
    const start = toDate(b.send_at);
    if (!start || start <= now) return [];
    return [
      {
        kind: "event",
        externalId: `scheduled:${b.id}`,
        title: `Sends: ${subject(b.subject)}`,
        state: "open",
        start,
        end: new Date(start.getTime() + SLOT_MS),
        busy: false,
        facts: [...fact("Account", name)],
        updatedAt: toDate(b.created_at),
      },
    ];
  });

  // A draft Sigwald holds that has been sent since is done.
  const listed = new Set(tasks.map((t) => t.externalId));
  const held = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !listed.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  // A held draft that's now scheduled has been written: its task is done.
  for (const b of scheduled.broadcasts) {
    const title = held.get(String(b.id));
    if (title === undefined) continue;
    held.delete(String(b.id));
    finished.push({
      kind: "task",
      externalId: String(b.id),
      title,
      state: "done",
      doneAt: now,
    });
  }
  // A cut-off list of scheduled sends can't vouch for the events it left out.
  let complete = drafts.complete && scheduled.complete;
  if (held.size > 0) {
    const since = new Date(
      (ctx.lastSuccessAt?.getTime() ?? now.getTime() - FIRST_LOOKBACK_MS) -
        86_400_000
    );
    const sent = await broadcastsWith(
      http,
      secret,
      "completed",
      since.toISOString().slice(0, 10)
    );
    if (!sent.complete) complete = false;
    for (const b of sent.broadcasts) {
      const title = held.get(String(b.id));
      if (title === undefined) continue;
      finished.push({
        kind: "task",
        externalId: String(b.id),
        title,
        state: "done",
        doneAt: toDate(b.published_at) ?? toDate(b.send_at) ?? now,
      });
    }
  }

  const readings: PulledReading[] = [];
  try {
    const subscribers = await activeSubscribers(http, secret);
    if (subscribers !== null) {
      readings.push({
        key: "subscribers",
        label: "Subscribers",
        value: subscribers,
        unit: "count",
      });
    }
  } catch (error) {
    if (!isConnectorError(error) || error.kind !== "forbidden") throw error;
  }

  return {
    items: [...tasks, ...events, ...finished],
    complete,
    readings,
  };
};
