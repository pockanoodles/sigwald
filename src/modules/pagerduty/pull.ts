/**
 * PagerDuty's pull: your on-call shifts for the next 14 days as events,
 * triggered and acknowledged incidents assigned to you as tasks, and, for
 * held incidents that no longer show up, one read of each to see whether it
 * was resolved (a resolved incident has no assignee, so no list can be asked
 * for "mine, resolved"). At most 20 such reads a pull.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  type PagerdutyIncident,
  type PagerdutyOncall,
  getIncident,
  listAssignedIncidents,
  listOncalls,
} from "@/lib/connectors/pagerduty/client";

import {
  type PullFn,
  type PulledEvent,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";

const HORIZON_DAYS = 14;
const MAX_CHECKS = 20;

function toEvent(oncall: PagerdutyOncall): PulledEvent | null {
  const start = toDate(oncall.start);
  const end = toDate(oncall.end);
  // A permanent on-call (a direct escalation target) has no shift to show.
  if (!start || !end) return null;
  const name =
    oncall.schedule?.summary ?? oncall.escalation_policy.summary ?? "On call";
  const where = oncall.schedule?.id ?? "direct";
  return {
    kind: "event",
    externalId: `${oncall.escalation_policy.id}:${where}:${oncall.escalation_level}:${start.toISOString()}`,
    title: `On call: ${oncall.escalation_policy.summary ?? name}`,
    state: "open",
    start,
    end,
    busy: false,
    url: oncall.schedule?.html_url ?? oncall.escalation_policy.html_url ?? null,
    facts: [
      ...fact("Schedule", oncall.schedule?.summary),
      ...fact("Escalation policy", oncall.escalation_policy.summary),
      ...fact("Level", oncall.escalation_level),
    ],
  };
}

function toTask(incident: PagerdutyIncident): PulledTask {
  return {
    kind: "task",
    externalId: incident.id,
    title: `Incident: ${incident.title}`,
    state: "open",
    url: incident.html_url,
    impact: incident.urgency === "high" ? 0.95 : 0.6,
    group: incident.service
      ? {
          key: `pagerduty:service:${incident.service.id.toLowerCase()}`,
          label: incident.service.summary ?? incident.service.id,
        }
      : null,
    facts: [
      ...fact("Incident", `#${incident.incident_number}`),
      ...fact("Service", incident.service?.summary),
      ...fact("Urgency", incident.urgency),
      ...fact("Status", incident.status),
      ...fact("Triggered", incident.created_at),
    ],
    updatedAt: toDate(incident.last_status_change_at),
  };
}

export const pullPagerduty: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const userId = config.userId ?? "";
  const until = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

  const shifts = await listOncalls(http, secret, userId, now, until);
  const events = shifts.items
    .map(toEvent)
    .filter((e): e is PulledEvent => e !== null);
  let complete = shifts.complete;

  const assigned = await listAssignedIncidents(http, secret, userId);
  if (!assigned.complete) complete = false;
  const open = assigned.items.map(toTask);

  const seen = new Set(open.map((t) => t.externalId));
  const missing = ctx.open.filter(
    (o) => o.kind === "task" && !seen.has(o.externalId)
  );
  if (missing.length > MAX_CHECKS) complete = false;
  const finished: PulledTask[] = [];
  for (const held of missing.slice(0, MAX_CHECKS)) {
    try {
      const incident = await getIncident(http, secret, held.externalId);
      if (incident.status === "resolved") {
        finished.push({
          kind: "task",
          externalId: held.externalId,
          title: held.title,
          state: "done",
          doneAt:
            toDate(incident.resolved_at) ??
            toDate(incident.last_status_change_at) ??
            now,
        });
      }
    } catch (error) {
      if (!(isConnectorError(error) && error.kind === "not_found")) {
        complete = false;
      }
    }
  }

  return { items: [...events, ...open, ...finished], complete };
};
