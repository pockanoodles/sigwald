/**
 * GitLab's pull: open merge requests that name you as a reviewer, issues
 * assigned to you and (if asked) your own open merge requests, plus what
 * closed or merged since the last pull, so finishing one finishes its task.
 *
 * Issues and merge requests are numbered per project, so each is keyed by
 * its project's id: `<project id>#<iid>` for an issue, `<project id>!<iid>`
 * for a merge request.
 */
import {
  type GitlabItem,
  listAll,
  projectPath,
} from "@/lib/connectors/gitlab/client";

import {
  type Fact,
  type PullFn,
  type PulledTask,
  dueDay,
  fact,
  impactFromLabels,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

type Kind = "review" | "mine" | "issue";
type Path = "issues" | "merge_requests";

const FIRST_LOOKBACK_MS = 7 * 86_400_000;

export function keyOf(item: GitlabItem, kind: Kind): string {
  return `${item.project_id}${kind === "issue" ? "#" : "!"}${item.iid}`;
}

function toTask(item: GitlabItem, kind: Kind): PulledTask {
  const path = projectPath(item);
  const name = path.split("/").pop() ?? path;
  const title =
    kind === "review"
      ? `Review: ${item.title}`
      : kind === "mine"
        ? `Your MR: ${item.title}`
        : item.title;
  const due = dueDay(item.due_date) ?? dueDay(item.milestone?.due_date);
  const facts: Fact[] = [
    ...fact("Project", path),
    ...fact(kind === "issue" ? "Issue" : "Merge request", `#${item.iid}`),
    ...fact("By", item.author ? `@${item.author.username}` : null),
    ...fact("Labels", item.labels.join(", ")),
    ...fact("Milestone", item.milestone?.title),
    ...fact("Comments", item.user_notes_count || null),
    ...fact("Draft", item.draft ? "Yes" : null),
  ];
  return {
    kind: "task",
    externalId: keyOf(item, kind),
    title,
    state: "open",
    url: item.web_url,
    description: item.description ? item.description.slice(0, 4000) : null,
    due,
    // Someone is waiting on a review, which matters even with no labels.
    impact: impactFromLabels(item.labels, kind === "review" ? 0.5 : null),
    group: { key: `gitlab:project:${path}`, label: name },
    facts,
    updatedAt: toDate(item.updated_at),
  };
}

export const pullGitlab: PullFn = async (ctx) => {
  const { http, secret, config, settings, now } = ctx;
  const username = config.username ?? "";

  const asks: { kind: Kind; path: Path; q: Record<string, string> }[] = [];
  if (setting.on(settings, "reviews") && username) {
    asks.push({
      kind: "review",
      path: "merge_requests",
      q: { scope: "all", reviewer_username: username },
    });
  }
  if (setting.on(settings, "issues")) {
    asks.push({
      kind: "issue",
      path: "issues",
      q: { scope: "assigned_to_me" },
    });
  }
  if (setting.on(settings, "mine")) {
    asks.push({
      kind: "mine",
      path: "merge_requests",
      q: { scope: "created_by_me" },
    });
  }

  let complete = true;
  const open = new Map<string, PulledTask>();
  for (const ask of asks) {
    const found = await listAll(http, secret, config, ask.path, {
      ...ask.q,
      state: "opened",
    });
    if (!found.complete) complete = false;
    for (const item of found.items) {
      const key = keyOf(item, ask.kind);
      // Reviews run first, so one that is also yours keeps its review.
      if (!open.has(key)) open.set(key, toTask(item, ask.kind));
    }
  }

  // What finished since the last pull, for held work the lists above no
  // longer show. Each keeps the title it was tracked by.
  const missing = new Map(
    ctx.open
      .filter((o) => !open.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (missing.size > 0) {
    const from = new Date(
      (ctx.lastSuccessAt?.getTime() ?? now.getTime() - FIRST_LOOKBACK_MS) -
        86_400_000
    ).toISOString();
    const closedAsks = asks.flatMap((ask) =>
      (ask.path === "issues" ? ["closed"] : ["merged", "closed"]).map(
        (state) => ({ ask, state })
      )
    );
    const answers = await Promise.all(
      closedAsks.map(({ ask, state }) =>
        listAll(
          http,
          secret,
          config,
          ask.path,
          { ...ask.q, state, updated_after: from },
          1
        )
      )
    );
    answers.forEach((answer, i) => {
      if (!answer.complete) complete = false;
      for (const item of answer.items) {
        const key = keyOf(item, closedAsks[i].ask.kind);
        const title = missing.get(key);
        if (title === undefined) continue;
        missing.delete(key);
        finished.push({
          kind: "task",
          externalId: key,
          title,
          state: "done",
          doneAt:
            toDate(item.merged_at) ??
            toDate(item.closed_at) ??
            toDate(item.updated_at) ??
            now,
        });
      }
    });
  }

  return { items: [...open.values(), ...finished], complete };
};
