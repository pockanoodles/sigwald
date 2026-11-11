import { TOGGL } from "@/lib/connectors/toggl/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const toggl: ModuleManifest = {
  id: "toggl",
  name: "Toggl Track",
  summary: "The hours you tracked today and this week, as numbers.",
  defaultOn: false,
  beta: true,
  shelf: "money",
  madeFor: ["Freelancers", "Consultants", "Anyone who bills by the hour"],
  sources: [],
  adds: [
    "Hours tracked today, read every 30 minutes",
    "Hours tracked this week, from Monday",
    "A running timer counts up to now",
  ],
  keeps:
    "Each day's hour totals. No descriptions, projects or clients from your entries.",
  egress: [TOGGL.egress],
  connect: {
    service: TOGGL,
    makes: ["readings"],
    everyMinutes: 30,
    headline: "hours_today",
    settings: [STATUS_FIELD],
  },
};

export default toggl;
