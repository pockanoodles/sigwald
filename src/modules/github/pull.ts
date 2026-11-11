/**
 * GitHub's pull: three searches for open work (reviews asked of you, issues
 * assigned to you, your pull requests with changes requested) and two for
 * what finished since the last pull, so a review you submitted or an issue
 * you closed finishes its task instead of just vanishing.
 *
 * A pull request and an issue share GitHub's numbering, so each is keyed
 * `owner/name#number`; one that's both a review and assigned to you is
 * tracked once, as the review.
 */
import {
  type GithubIssue,
  repoOf,
  searchIssues,
} from "@/lib/connectors/github/client";
import { dayIn, shiftDay } from "@/lib/date-utils";

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

type Kind = "review" | "changes" | "issue";

const FIRST_LOOKBACK_DAYS = 7;

/** The claim keys Code uses for a repo (src/modules/code/facts.ts), so one goal claims both. */
export function repoClaims(repo: string): {
  group: { key: string; label: string };
  owner: string;
} {
  const [owner, name] = repo.split("/");
  return {
    group: { key: `repo:${repo}`, label: name ?? repo },
    owner: `owner:${owner}`,
  };
}

function labelNames(issue: GithubIssue): string[] {
  return issue.labels
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter(Boolean);
}

export function keyOf(issue: GithubIssue): string {
  return `${repoOf(issue)}#${issue.number}`;
}

function toTask(issue: GithubIssue, kind: Kind): PulledTask {
  const repo = repoOf(issue);
  const { group, owner } = repoClaims(repo);
  const labels = labelNames(issue);
  const title =
    kind === "review"
      ? `Review: ${issue.title}`
      : kind === "changes"
        ? `Address review: ${issue.title}`
        : issue.title;
  const facts: Fact[] = [
    ...fact("Repo", repo),
    ...fact(kind === "issue" ? "Issue" : "Pull request", `#${issue.number}`),
    ...fact("By", issue.user ? `@${issue.user.login}` : null),
    ...fact("Labels", labels.join(", ")),
    ...fact("Milestone", issue.milestone?.title),
    ...fact("Comments", issue.comments || null),
    ...fact("Draft", issue.draft ? "Yes" : null),
  ];
  return {
    kind: "task",
    externalId: keyOf(issue),
    title,
    state: "open",
    url: issue.html_url,
    description: issue.body ? issue.body.slice(0, 4000) : null,
    due: dueDay(issue.milestone?.due_on),
    // Someone is waiting on a review, which matters even with no labels.
    impact: impactFromLabels(labels, kind === "issue" ? null : 0.5),
    group,
    claims: [owner],
    facts,
    updatedAt: toDate(issue.updated_at),
  };
}

function inScope(repo: string, only: string[], skip: string[]): boolean {
  const lower = (list: string[]) => list.map((r) => r.toLowerCase());
  if (only.length > 0 && !lower(only).includes(repo)) return false;
  return !lower(skip).includes(repo);
}

export const pullGithub: PullFn = async (ctx) => {
  const { http, secret, settings, now, timeZone } = ctx;
  const only = setting.list(settings, "only");
  const skip = setting.list(settings, "skip");
  const reviewQualifier = setting.on(settings, "teams")
    ? "review-requested:@me"
    : "user-review-requested:@me";

  const searches: { kind: Kind; q: string }[] = [];
  if (setting.on(settings, "reviews")) {
    searches.push({
      kind: "review",
      q: `is:open is:pr ${reviewQualifier} archived:false`,
    });
  }
  if (setting.on(settings, "changes")) {
    searches.push({
      kind: "changes",
      q: "is:open is:pr author:@me review:changes_requested archived:false",
    });
  }
  if (setting.on(settings, "issues")) {
    searches.push({
      kind: "issue",
      q: "is:open is:issue assignee:@me archived:false",
    });
  }

  let complete = true;
  const open = new Map<string, PulledTask>();
  for (const search of searches) {
    const found = await searchIssues(http, secret, search.q);
    if (!found.complete) complete = false;
    for (const issue of found.items) {
      if (!inScope(repoOf(issue), only, skip)) continue;
      const key = keyOf(issue);
      // Searches run review first, so a pull request that's both keeps its review.
      if (!open.has(key)) open.set(key, toTask(issue, search.kind));
    }
  }

  // What finished since the last pull, for the open work Sigwald holds that
  // the searches above no longer find: an issue closed, a review submitted,
  // your own pull request merged. Each keeps the title it was tracked by.
  const missing = new Map(
    ctx.open
      .filter((o) => !open.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (missing.size > 0) {
    const from =
      ctx.lastSuccessAt ??
      new Date(now.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
    const since = shiftDay(dayIn(from, timeZone), -1);
    const asks = [
      {
        q: `is:closed assignee:@me closed:>=${since} archived:false`,
        at: "closed_at",
      },
      {
        q: `is:pr reviewed-by:@me -author:@me updated:>=${since} archived:false`,
        at: "updated_at",
      },
      {
        q: `is:pr is:closed author:@me closed:>=${since} archived:false`,
        at: "closed_at",
      },
    ] as const;
    const answers = await Promise.all(
      asks.map((a) => searchIssues(http, secret, a.q, 1))
    );
    answers.forEach((answer, i) => {
      if (!answer.complete) complete = false;
      for (const issue of answer.items) {
        const key = keyOf(issue);
        const title = missing.get(key);
        if (title === undefined) continue;
        missing.delete(key);
        finished.push({
          ...toTask(issue, issue.pull_request ? "changes" : "issue"),
          title,
          state: "done",
          doneAt: toDate(issue[asks[i].at]) ?? now,
        });
      }
    });
  }

  return { items: [...open.values(), ...finished], complete };
};
