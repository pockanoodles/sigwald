/**
 * WordPress's pull: your drafts as "Finish" tasks, your pending posts as
 * "Review" tasks, your scheduled posts as free calendar events at their
 * publish time, and a held task whose post is published now as done.
 */
import {
  type WpPost,
  gmt,
  publishedAmong,
  unpublished,
} from "@/lib/connectors/wordpress/client";

import {
  type PullFn,
  type PulledEvent,
  type PulledTask,
  fact,
  plainText,
} from "@/modules/connect/pull";

const SLOT_MS = 15 * 60_000;

function titleOf(post: WpPost): string {
  const raw = post.title.raw ?? plainText(post.title.rendered, 200) ?? "";
  return raw.trim() || "Untitled";
}

export const pullWordpress: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const auth = { secret, config };
  const host = new URL(config.site).hostname;
  const group = { key: `wordpress:site:${host.toLowerCase()}`, label: host };
  const edit = (id: number) =>
    `${config.site}/wp-admin/post.php?post=${id}&action=edit`;

  const listed = await unpublished(http, auth);
  const tasks: PulledTask[] = [];
  const events: PulledEvent[] = [];
  for (const post of listed.posts) {
    const title = titleOf(post);
    if (post.status === "future") {
      const start = gmt(post.date_gmt);
      if (!start) continue;
      events.push({
        kind: "event",
        externalId: `scheduled:${post.id}`,
        title: `Publishes: ${title}`,
        state: "open",
        start,
        end: new Date(start.getTime() + SLOT_MS),
        busy: false,
        url: edit(post.id),
        facts: [...fact("Site", host)],
        updatedAt: gmt(post.modified_gmt),
      });
    } else if (post.status === "draft" || post.status === "pending") {
      const pending = post.status === "pending";
      tasks.push({
        kind: "task",
        externalId: String(post.id),
        title: `${pending ? "Review" : "Finish"}: ${title}`,
        state: "open",
        url: edit(post.id),
        group,
        facts: [
          ...fact("Status", pending ? "Pending review" : "Draft"),
          ...fact("Site", host),
        ],
        updatedAt: gmt(post.modified_gmt),
      });
    }
  }

  const seen = new Set(tasks.map((t) => t.externalId));
  const held = new Map(
    ctx.open
      .filter(
        (o) =>
          o.kind === "task" &&
          /^\d+$/.test(o.externalId) &&
          !seen.has(o.externalId)
      )
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = (
    await publishedAmong(http, auth, [...held.keys()].slice(0, 100).map(Number))
  ).map((post) => ({
    kind: "task",
    externalId: String(post.id),
    title: held.get(String(post.id)) ?? `Finish: ${titleOf(post)}`,
    state: "done",
    doneAt: gmt(post.date_gmt) ?? now,
  }));

  return {
    items: [...tasks, ...events, ...finished],
    complete: listed.complete,
  };
};
