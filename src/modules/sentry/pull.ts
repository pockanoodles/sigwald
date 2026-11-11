/**
 * Sentry's pull: unresolved issues assigned to you, and, for held issues
 * that no longer show up, one read of each to see whether it was resolved,
 * so resolving an issue in Sentry finishes its task. Sentry doesn't list
 * "resolved since", so held issues are asked after by id (at most 20 a pull).
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  type SentryIssue,
  getIssue,
  searchIssues,
} from "@/lib/connectors/sentry/client";

import {
  type PullFn,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";

const MAX_CHECKS = 20;

/** Sentry's level as Sigwald's weight. */
export function impactOfLevel(level: string | undefined): number | null {
  switch (level) {
    case "fatal":
      return 0.9;
    case "error":
      return 0.7;
    case "warning":
      return 0.4;
    case "info":
    case "debug":
      return 0.15;
    default:
      return null;
  }
}

function toTask(issue: SentryIssue): PulledTask {
  const project = issue.project;
  return {
    kind: "task",
    externalId: issue.id,
    title: `Fix: ${issue.title}`,
    state: "open",
    url: issue.permalink ?? null,
    impact: impactOfLevel(issue.level),
    group: project
      ? {
          key: `sentry:project:${project.slug.toLowerCase()}`,
          label: project.name,
        }
      : null,
    facts: [
      ...fact("Project", project?.name),
      ...fact("Issue", issue.shortId),
      ...fact("Level", issue.level),
      ...fact("Events", issue.count),
      ...fact("Users", issue.userCount),
      ...fact("First seen", issue.firstSeen),
      ...fact("Last seen", issue.lastSeen),
    ],
    updatedAt: toDate(issue.lastSeen),
  };
}

export const pullSentry: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;

  const found = await searchIssues(
    http,
    secret,
    config,
    "is:unresolved assigned:me"
  );
  let complete = found.complete;
  const open = found.issues.map(toTask);

  const seen = new Set(open.map((t) => t.externalId));
  const missing = ctx.open.filter(
    (o) => o.kind === "task" && !seen.has(o.externalId)
  );
  if (missing.length > MAX_CHECKS) complete = false;
  const finished: PulledTask[] = [];
  for (const held of missing.slice(0, MAX_CHECKS)) {
    try {
      const issue = await getIssue(http, secret, config, held.externalId);
      if (issue.status === "resolved") {
        finished.push({
          kind: "task",
          externalId: held.externalId,
          title: held.title,
          state: "done",
          doneAt: now,
        });
      }
    } catch (error) {
      // A deleted issue is simply gone; any other failure may hide a resolution.
      if (!(isConnectorError(error) && error.kind === "not_found")) {
        complete = false;
      }
    }
  }

  return { items: [...open, ...finished], complete };
};
