import { INTERVALS } from "@/lib/connectors/intervals/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const intervals: ModuleManifest = {
  id: "intervals",
  name: "Intervals.icu",
  summary:
    "Your planned workouts for the next two weeks as tasks due that day, finished once an activity is matched, with fitness, fatigue and form as numbers.",
  defaultOn: false,
  beta: true,
  shelf: "health",
  madeFor: ["Runners", "Cyclists", "Triathletes"],
  sources: ["INTERVALS"],
  linkLabels: { INTERVALS: "Open in Intervals.icu" },
  claimLabels: { INTERVALS: "All Intervals.icu training" },
  adds: [
    "A task for each planned workout in the next 14 days, due that day, with its planned minutes",
    "The task is done once Intervals.icu matches an activity to the workout",
    "Fitness, fatigue and form from today's wellness record, read every few hours",
  ],
  keeps:
    "For each planned workout: its name, sport, day, planned minutes and link. Each day's fitness and fatigue numbers.",
  egress: [INTERVALS.egress],
  connect: {
    service: INTERVALS,
    makes: ["tasks", "readings"],
    everyMinutes: 60,
    headline: "form",
    settings: [maxOpenField(14), STATUS_FIELD],
  },
};

export default intervals;
