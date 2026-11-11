/**
 * Feeds' pull: each feed through the egress, its posts within the days kept
 * as tasks. A feed that fails keeps the others' tasks (the pull is partial);
 * a post keeps its identity by the feed's own id for it, never its title.
 */
import { createHash } from "node:crypto";

import { parseFeed } from "@/lib/connectors/web/feed";

import {
  type PullFn,
  type PulledTask,
  fact,
  plainText,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const MAX_ENTRIES = 100;

const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

export const pullFeeds: PullFn = async ({ http, settings, now }) => {
  const links = setting.list(settings, "feeds");
  const only = setting.text(settings, "only").toLowerCase();
  const since =
    now.getTime() - setting.number(settings, "days", 7) * 86_400_000;

  const items: PulledTask[] = [];
  let complete = true;
  for (const link of links) {
    let feed;
    try {
      feed = parseFeed(await http.text(link));
    } catch (error) {
      complete = false;
      if (links.length === 1) throw error;
      continue;
    }
    const feedKey = hash(link);
    const feedTitle = feed.title ?? new URL(link).hostname;
    // A feed shows only its latest posts. Unless what it shows reaches back
    // past the window, a post that fell off it may still be inside the
    // window, and mustn't close as if it had aged out.
    const dated = feed.entries
      .slice(0, MAX_ENTRIES)
      .flatMap((e) => (e.published ? [e.published.getTime()] : []));
    const reachedBack =
      feed.entries.length <= MAX_ENTRIES &&
      dated.length > 0 &&
      Math.min(...dated) < since;
    if (!reachedBack) complete = false;
    for (const e of feed.entries.slice(0, MAX_ENTRIES)) {
      // A post with no date can't be placed in the window: leave it.
      if (!e.published || e.published.getTime() < since) continue;
      if (only && !e.title.toLowerCase().includes(only)) continue;
      items.push({
        kind: "task",
        externalId: `${feedKey}:${hash(e.id || e.link || e.title)}`,
        title: e.title,
        state: "open",
        url: e.link,
        description: plainText(e.summary, 1200),
        group: { key: `feeds:feed:${feedKey}`, label: feedTitle },
        facts: [
          ...fact("Feed", feedTitle),
          ...fact("By", e.authors.join(", ")),
          ...fact("Posted", e.published.toISOString().slice(0, 10)),
        ],
        updatedAt: e.published,
      });
    }
  }
  return { items, complete };
};
