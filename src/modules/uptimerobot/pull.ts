/**
 * UptimeRobot's pull: every monitor that is down becomes a task, and the
 * monitors' counts and 30-day uptime become readings. A held task whose
 * monitor is up again is done; one whose monitor was deleted or paused goes.
 * A monitor that only "looks down" (UptimeRobot is still confirming) keeps
 * an open task that was already there but doesn't start one.
 */
import {
  type UptimeRobotMonitor,
  monitors,
  uptime30,
} from "@/lib/connectors/uptimerobot/client";

import {
  type PullFn,
  type PulledReading,
  type PulledTask,
  fact,
} from "@/modules/connect/pull";

export function downTask(m: UptimeRobotMonitor): PulledTask {
  return {
    kind: "task",
    externalId: String(m.id),
    title: `Down: ${m.friendlyName}`,
    state: "open",
    url: `https://dashboard.uptimerobot.com/monitors/${m.id}`,
    description: m.url ? `UptimeRobot checks ${m.url}.` : null,
    impact: 0.95,
    group: {
      key: `uptimerobot:monitor:${m.id}`,
      label: m.friendlyName,
    },
    facts: [...fact("Address", m.url), ...fact("Status", "Down")],
  };
}

export const pullUptimeRobot: PullFn = async ({ http, secret, open, now }) => {
  const list = await monitors(http, secret);
  const heldTitles = new Map(open.map((o) => [o.externalId, o.title]));
  const items: PulledTask[] = [];
  for (const m of list.monitors) {
    const id = String(m.id);
    const held = heldTitles.get(id);
    if (m.status === "DOWN" || (m.status === "LOOKS_DOWN" && held)) {
      items.push(downTask(m));
    } else if (held !== undefined) {
      items.push({
        kind: "task",
        externalId: id,
        title: held,
        state: m.status === "UP" ? "done" : "gone",
        doneAt: m.status === "UP" ? now : null,
      });
    }
  }

  const readings: PulledReading[] = [
    {
      key: "up",
      label: "Monitors up",
      value: list.monitors.filter((m) => m.status === "UP").length,
      unit: "count",
    },
  ];
  // A total of the first thousand isn't the total: leave the counts out.
  if (list.complete) {
    readings.push({
      key: "total",
      label: "Monitors",
      value: list.monitors.length,
      unit: "count",
    });
  } else {
    readings.length = 0;
  }
  const uptime = await uptime30(http, secret);
  if (typeof uptime === "number" && Number.isFinite(uptime)) {
    readings.push({
      key: "uptime30",
      label: "Uptime, 30 days",
      value: Math.round(uptime * 100) / 100,
      unit: "percent",
    });
  }
  return { items, complete: list.complete, readings };
};
