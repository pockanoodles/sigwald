/**
 * Figma's pull: for each file you list, the comment threads that are open,
 * were not started by you and were not last answered by you. A thread that
 * is resolved, or that you answered last, finishes the task Sigwald holds.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  type FigmaComment,
  fileComments,
  fileKey,
  fileName,
} from "@/lib/connectors/figma/client";

import {
  type PullFn,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const MAX_FILES = 20;

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

interface Thread {
  root: FigmaComment;
  replies: FigmaComment[];
  last: FigmaComment;
}

export function threadsOf(comments: readonly FigmaComment[]): Thread[] {
  const byRoot = new Map<string, FigmaComment[]>();
  for (const c of comments) {
    if (c.parent_id) {
      byRoot.set(c.parent_id, [...(byRoot.get(c.parent_id) ?? []), c]);
    }
  }
  return comments
    .filter((c) => !c.parent_id)
    .map((root) => {
      const replies = byRoot.get(root.id) ?? [];
      const last = [root, ...replies].reduce((a, b) =>
        Date.parse(b.created_at) >= Date.parse(a.created_at) ? b : a
      );
      return { root, replies, last };
    });
}

export const pullFigma: PullFn = async (ctx) => {
  const { http, secret, config, settings } = ctx;
  const me = config.userId;
  const handle = (config.handle ?? "").toLowerCase();
  const mentionsOnly = setting.on(settings, "mentionsOnly");
  const keys = [
    ...new Set(
      setting
        .list(settings, "files")
        .map(fileKey)
        .filter((k): k is string => k !== null)
    ),
  ];

  const held = new Map(ctx.open.map((o) => [o.externalId, o.title]));
  const items: PulledTask[] = [];
  let complete = keys.length <= MAX_FILES;

  for (const key of keys.slice(0, MAX_FILES)) {
    let name: string;
    let comments: FigmaComment[];
    try {
      name = await fileName(http, secret, key);
      comments = await fileComments(http, secret, key);
    } catch (error) {
      // A file that's gone or not shared with you is skipped, not fatal.
      if (
        isConnectorError(error) &&
        (error.kind === "not_found" || error.kind === "forbidden")
      ) {
        complete = false;
        continue;
      }
      throw error;
    }

    for (const thread of threadsOf(comments)) {
      const { root, last } = thread;
      const externalId = `${key}:${root.id}`;
      const text = [root, ...thread.replies].map((c) => c.message ?? "");
      const mentioned =
        handle !== "" &&
        text.some((m) => m.toLowerCase().includes(`@${handle}`));
      const waiting =
        !root.resolved_at &&
        root.user.id !== me &&
        last.user.id !== me &&
        (!mentionsOnly || mentioned);

      if (waiting) {
        items.push({
          kind: "task",
          externalId,
          title: `Reply in ${name}: ${oneLine(root.message ?? "", 80)}`,
          state: "open",
          url: `https://www.figma.com/design/${key}`,
          description: `${last.user.handle}: ${oneLine(last.message ?? "", 500)}`,
          group: { key: `figma:file:${key.toLowerCase()}`, label: name },
          facts: [
            ...fact("File", name),
            ...fact("Started by", root.user.handle),
            ...fact("Last from", last.user.handle),
            ...fact("Messages", 1 + thread.replies.length),
          ],
          updatedAt: toDate(last.created_at),
        });
      } else if (
        held.has(externalId) &&
        (root.resolved_at || last.user.id === me)
      ) {
        items.push({
          kind: "task",
          externalId,
          title: held.get(externalId)!,
          state: "done",
          doneAt: toDate(root.resolved_at ?? last.created_at) ?? ctx.now,
        });
      }
    }
  }
  return { items, complete };
};
