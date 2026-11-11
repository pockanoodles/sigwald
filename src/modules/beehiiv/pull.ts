/**
 * beehiiv's pull: drafts as tasks, posts scheduled for later as free
 * calendar events, a held draft that has been scheduled or sent since as
 * done, and the active subscribers as a reading.
 */
import { activeSubscribers, postsWith } from "@/lib/connectors/beehiiv/client";
import { isConnectorError } from "@/lib/connectors/errors";

import {
  type PullFn,
  type PulledEvent,
  type PulledReading,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";

const SLOT_MS = 15 * 60_000;

export const pullBeehiiv: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const auth = { secret, config };
  const name = config.name || "Newsletter";
  const group = {
    key: `beehiiv:publication:${config.publicationId.toLowerCase()}`,
    label: name,
  };

  const drafts = await postsWith(http, auth, "draft", {
    by: "created",
    direction: "desc",
  });
  // Newest send time first: the ones still ahead, then what went out lately.
  const confirmed = await postsWith(http, auth, "confirmed", {
    by: "publish_date",
    direction: "desc",
  });

  const tasks: PulledTask[] = drafts.posts.map((p) => ({
    kind: "task",
    externalId: p.id,
    title: `Finish: ${p.title?.trim() || "Untitled"}`,
    state: "open",
    url: p.web_url || null,
    group,
    facts: [...fact("Status", "Draft"), ...fact("Publication", name)],
    updatedAt: toDate(p.created),
  }));

  const events: PulledEvent[] = confirmed.posts.flatMap((p) => {
    const start = toDate(p.publish_date);
    if (!start || start <= now) return [];
    return [
      {
        kind: "event",
        externalId: `scheduled:${p.id}`,
        title: `Sends: ${p.title?.trim() || "Untitled"}`,
        state: "open",
        start,
        end: new Date(start.getTime() + SLOT_MS),
        busy: false,
        url: p.web_url || null,
        facts: [...fact("Publication", name)],
      },
    ];
  });

  // A draft Sigwald holds that is now confirmed (scheduled or sent) is done.
  const listed = new Set(tasks.map((t) => t.externalId));
  const held = new Map(
    ctx.open
      .filter((o) => o.kind === "task" && !listed.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = confirmed.posts.flatMap((p) => {
    const title = held.get(p.id);
    if (title === undefined) return [];
    const at = toDate(p.publish_date);
    return [
      {
        kind: "task",
        externalId: p.id,
        title,
        state: "done",
        doneAt: at && at <= now ? at : now,
      },
    ];
  });

  const readings: PulledReading[] = [];
  try {
    const subscribers = await activeSubscribers(http, auth);
    if (subscribers !== null) {
      readings.push({
        key: "subscribers",
        label: "Subscribers",
        value: subscribers,
        unit: "count",
      });
    }
  } catch (error) {
    if (
      !isConnectorError(error) ||
      (error.kind !== "forbidden" && error.kind !== "bad_response")
    ) {
      throw error;
    }
  }

  return {
    items: [...tasks, ...events, ...finished],
    complete: drafts.complete,
    readings,
  };
};
