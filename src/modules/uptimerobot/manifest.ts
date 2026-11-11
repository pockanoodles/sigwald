import { UPTIMEROBOT } from "@/lib/connectors/uptimerobot/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const uptimerobot: ModuleManifest = {
  id: "uptimerobot",
  name: "UptimeRobot",
  summary:
    "A task for each UptimeRobot monitor that is down, done when it is up again, with monitors up and 30-day uptime as numbers.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["Agencies", "Indie hackers", "On-call engineers"],
  sources: ["UPTIMEROBOT"],
  linkLabels: { UPTIMEROBOT: "Open in UptimeRobot" },
  claimLabels: { UPTIMEROBOT: "All UptimeRobot monitors" },
  adds: [
    'A task, "Down: <monitor>", for each monitor that is down, ranked high in Focus',
    "The task is done once the monitor is up again",
    "Monitors up, monitors total and average uptime over 30 days",
  ],
  keeps:
    "For each monitor that is down: its name, address and link. Each day's counts of monitors and the 30-day uptime.",
  egress: [UPTIMEROBOT.egress],
  connect: {
    service: UPTIMEROBOT,
    makes: ["tasks", "readings"],
    everyMinutes: 15,
    headline: "up",
    settings: [maxOpenField(20), STATUS_FIELD],
  },
};

export default uptimerobot;
