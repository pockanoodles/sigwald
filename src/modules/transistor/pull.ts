/**
 * Transistor's pull: draft episodes become "Finish episode" tasks, scheduled
 * episodes become free-time events at their release time, and the shows'
 * downloads over 30 days become a reading.
 *
 * Done detection: a draft Sigwald holds that is no longer a draft is read by
 * id (at most 20 a pull), and a published one finishes its task at its
 * publish time. Transistor's analytics has no all-shows endpoint, so the
 * reading sums one call per show (at most 8 shows).
 */
import {
  type TransistorEpisode,
  type TransistorShow,
  getEpisode,
  listEpisodes,
  listShows,
  showDownloads,
  transistorTime,
} from "@/lib/connectors/transistor/client";
import { dayIn, shiftDay } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledEvent,
  type PulledReading,
  type PulledTask,
  fact,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const MAX_LOOKUPS = 20;
const MAX_SHOWS_FOR_DOWNLOADS = 8;
const RELEASE_MINUTES = 30;

const taskId = (id: string) => `episode:${id}`;

function groupOf(episode: TransistorEpisode, shows: Map<string, string>) {
  const id = episode.relationships?.show?.data?.id;
  if (!id) return { show: null, group: null };
  const label = shows.get(id) ?? "Podcast";
  return {
    show: label,
    group: { key: `transistor:show:${id}`, label },
  };
}

function episodeFacts(episode: TransistorEpisode, show: string | null) {
  return [...fact("Show", show), ...fact("Status", episode.attributes.status)];
}

function draftTask(
  episode: TransistorEpisode,
  shows: Map<string, string>
): PulledTask {
  const { show, group } = groupOf(episode, shows);
  const title = episode.attributes.title?.trim() || "Untitled";
  return {
    kind: "task",
    externalId: taskId(episode.id),
    title: `Finish episode: ${title}`,
    state: "open",
    url: episode.attributes.share_url ?? null,
    group,
    facts: episodeFacts(episode, show),
  };
}

function releaseEvent(
  episode: TransistorEpisode,
  shows: Map<string, string>
): PulledEvent | null {
  const start = transistorTime(episode.attributes.published_at);
  if (!start) return null;
  const { show, group } = groupOf(episode, shows);
  return {
    kind: "event",
    externalId: `release:${episode.id}`,
    title: episode.attributes.title?.trim() || "Untitled",
    state: "open",
    start,
    end: new Date(start.getTime() + RELEASE_MINUTES * 60_000),
    busy: false,
    url: episode.attributes.share_url ?? null,
    description: group ? `Releases on ${group.label}` : null,
    facts: episodeFacts(episode, show),
  };
}

/** dd-mm-yyyy, the date format Transistor's analytics asks for. */
function ddmmyyyy(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}-${m}-${y}`;
}

export const pullTransistor: PullFn = async (ctx) => {
  const { http, secret, settings, now, timeZone } = ctx;
  const only = setting.text(settings, "show").trim();
  let complete = true;

  const allShows = await listShows(http, secret);
  if (!allShows.complete) complete = false;
  const shows: TransistorShow[] = only
    ? allShows.data.filter((s) => s.id === only || s.attributes.slug === only)
    : allShows.data;
  const titles = new Map(
    shows.map((s) => [s.id, s.attributes.title ?? "Podcast"])
  );
  // Asked of Transistor by the id it knows the show by, even when the setting was a slug.
  const showId = only ? (shows[0]?.id ?? only) : undefined;

  const [drafts, scheduled] = await Promise.all([
    listEpisodes(http, secret, "draft", showId),
    listEpisodes(http, secret, "scheduled", showId),
  ]);
  if (!drafts.complete || !scheduled.complete) complete = false;

  const items: (PulledTask | PulledEvent)[] = [];
  const openIds = new Set<string>();
  for (const episode of drafts.data) {
    items.push(draftTask(episode, titles));
    openIds.add(taskId(episode.id));
  }
  for (const episode of scheduled.data) {
    const event = releaseEvent(episode, titles);
    if (event) items.push(event);
  }

  // Held drafts that left the draft list: finished if they are published now.
  const missing = ctx.open
    .filter(
      (o) =>
        o.kind === "task" &&
        o.externalId.startsWith("episode:") &&
        !openIds.has(o.externalId)
    )
    .slice(0, MAX_LOOKUPS);
  const unchecked = ctx.open.filter(
    (o) =>
      o.kind === "task" &&
      o.externalId.startsWith("episode:") &&
      !openIds.has(o.externalId)
  ).length;
  if (unchecked > MAX_LOOKUPS) complete = false;
  for (const held of missing) {
    try {
      const episode = await getEpisode(
        http,
        secret,
        held.externalId.slice("episode:".length)
      );
      if (episode?.attributes.status === "published") {
        items.push({
          kind: "task",
          externalId: held.externalId,
          title: held.title,
          state: "done",
          doneAt: transistorTime(episode.attributes.published_at) ?? now,
        });
      }
    } catch {
      complete = false;
    }
  }

  const readings: PulledReading[] = [];
  const end = dayIn(now, timeZone);
  const start = shiftDay(end, -29);
  if (shows.length > 0) {
    const counted = shows.slice(0, MAX_SHOWS_FOR_DOWNLOADS);
    if (shows.length > counted.length) complete = false;
    try {
      let total = 0;
      for (const show of counted) {
        total += await showDownloads(
          http,
          secret,
          show.id,
          ddmmyyyy(start),
          ddmmyyyy(end)
        );
      }
      if (shows.length === counted.length) {
        readings.push({
          key: "downloads30",
          label: "Downloads, 30 days",
          value: total,
          unit: "count",
        });
      }
    } catch {
      complete = false;
    }
  }

  return { items, complete, readings };
};
