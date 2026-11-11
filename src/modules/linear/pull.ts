/**
 * Linear's pull: every open issue assigned to you, and the ones completed
 * since the last pull, so finishing an issue in Linear finishes its task.
 * A cancelled one simply stops being listed, and its task closes undone.
 */
import {
  type LinearIssue,
  assignedCompletedSince,
  assignedOpenIssues,
} from "@/lib/connectors/linear/client";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  dueDay,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const FIRST_LOOKBACK_MS = 7 * 86_400_000;

/** Linear's priority (1 urgent … 4 low, 0 none) as Sigwald's weight. */
export function impactOfPriority(priority: number): number | null {
  return (
    ({ 1: 0.9, 2: 0.7, 3: 0.4, 4: 0.15 } as Record<number, number>)[priority] ??
    null
  );
}

export function toTask(issue: LinearIssue, cycleDue: boolean): PulledTask {
  const due =
    dueDay(issue.dueDate) ??
    (cycleDue && issue.cycle ? dueAt(issue.cycle.endsAt) : null);
  return {
    kind: "task",
    externalId: issue.id,
    title: `${issue.identifier} ${issue.title}`,
    state: "open",
    url: issue.url,
    description: issue.description ? issue.description.slice(0, 4000) : null,
    due,
    impact: impactOfPriority(issue.priority),
    group: {
      key: `linear:team:${issue.team.key.toLowerCase()}`,
      label: issue.team.name,
    },
    claims: issue.project
      ? [
          {
            key: `linear:project:${issue.project.id}`,
            label: `${issue.project.name} (Linear)`,
          },
        ]
      : [],
    facts: [
      ...fact("Issue", issue.identifier),
      ...fact("State", issue.state.name),
      ...fact("Priority", issue.priority ? issue.priorityLabel : null),
      ...fact("Team", issue.team.name),
      ...fact("Project", issue.project?.name),
      ...fact("Cycle", issue.cycle ? `Cycle ${issue.cycle.number}` : null),
      ...fact("Estimate", issue.estimate),
      ...fact("Labels", issue.labels.nodes.map((l) => l.name).join(", ")),
    ],
    updatedAt: toDate(issue.updatedAt),
  };
}

export const pullLinear: PullFn = async (ctx) => {
  const { http, secret, settings, now } = ctx;
  const teams = setting.list(settings, "teams").map((t) => t.toUpperCase());
  const cycleDue = setting.on(settings, "cycleDue");

  const { issues, complete } = await assignedOpenIssues(http, secret);
  const open = issues
    .filter(
      (i) => teams.length === 0 || teams.includes(i.team.key.toUpperCase())
    )
    .map((i) => toTask(i, cycleDue));

  const seen = new Set(open.map((t) => t.externalId));
  const missing = new Map(
    ctx.open
      .filter((o) => !seen.has(o.externalId))
      .map((o) => [o.externalId, o.title])
  );
  const finished: PulledTask[] = [];
  if (missing.size > 0) {
    const since = new Date(
      (ctx.lastSuccessAt?.getTime() ?? now.getTime() - FIRST_LOOKBACK_MS) -
        86_400_000
    );
    for (const done of await assignedCompletedSince(http, secret, since)) {
      const title = missing.get(done.id);
      if (title === undefined) continue;
      finished.push({
        kind: "task",
        externalId: done.id,
        title,
        state: "done",
        doneAt: toDate(done.completedAt) ?? now,
      });
    }
  }
  return { items: [...open, ...finished], complete };
};
