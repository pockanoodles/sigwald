/**
 * Jira's pull: every issue assigned to you that is not in the Done category,
 * and, for open work Sigwald holds that no longer shows up, a second search
 * for which of those reached the Done category, so finishing an issue in
 * Jira finishes its task. An issue moved to another project gets a new key
 * and is treated as new.
 */
import { type JiraIssue, searchJql } from "@/lib/connectors/jira/client";

import {
  type PullFn,
  type PulledTask,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";

/** Jira's priority names as Sigwald's weight (Highest 0.9 … Lowest 0.15). */
export function impactOfPriority(name: string | undefined): number | null {
  switch (name?.toLowerCase()) {
    case "highest":
    case "blocker":
      return 0.9;
    case "high":
    case "critical":
    case "major":
      return 0.7;
    case "medium":
      return 0.4;
    case "low":
    case "minor":
    case "lowest":
    case "trivial":
      return 0.15;
    default:
      return null;
  }
}

function toTask(issue: JiraIssue, site: string): PulledTask {
  const f = issue.fields;
  const project = f.project;
  return {
    kind: "task",
    externalId: issue.key,
    title: `${issue.key} ${f.summary ?? ""}`.trim(),
    state: "open",
    url: `${site.replace(/\/+$/, "")}/browse/${issue.key}`,
    due: dueDay(f.duedate),
    impact: impactOfPriority(f.priority?.name),
    group: project
      ? {
          key: `jira:project:${project.key.toLowerCase()}`,
          label: project.name,
        }
      : null,
    facts: [
      ...fact("Issue", issue.key),
      ...fact("Project", project?.name),
      ...fact("Type", f.issuetype?.name),
      ...fact("Status", f.status?.name),
      ...fact("Priority", f.priority?.name),
      ...fact("Labels", f.labels?.join(", ")),
    ],
    updatedAt: toDate(f.updated),
  };
}

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export const pullJira: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const site = config.site ?? "";

  const found = await searchJql(
    http,
    secret,
    config,
    "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
  );
  let complete = found.complete;
  const open = found.issues.map((i) => toTask(i, site));

  const seen = new Set(open.map((t) => t.externalId));
  const missing = new Map(
    ctx.open
      .filter((o) => !seen.has(o.externalId) && KEY.test(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (missing.size > 0) {
    // Ask after exactly the held issues, so a busy week of Done work can't push them off a page.
    const keys = [...missing.keys()].slice(0, 50);
    if (keys.length < missing.size) complete = false;
    const done = await searchJql(
      http,
      secret,
      config,
      `key in (${keys.join(",")}) AND statusCategory = Done`,
      1
    );
    if (!done.complete) complete = false;
    for (const issue of done.issues) {
      const title = missing.get(issue.key);
      if (title === undefined) continue;
      finished.push({
        kind: "task",
        externalId: issue.key,
        title,
        state: "done",
        doneAt:
          toDate(issue.fields.statuscategorychangedate) ??
          toDate(issue.fields.updated) ??
          now,
      });
    }
  }

  return { items: [...open, ...finished], complete };
};
