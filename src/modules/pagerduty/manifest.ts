import { PAGERDUTY } from "@/lib/connectors/pagerduty/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const pagerduty: ModuleManifest = {
  id: "pagerduty",
  name: "PagerDuty",
  summary:
    "Your on-call shifts on the calendar for the next two weeks, and the incidents assigned to you as tasks that finish when they are resolved.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["On-call engineers", "SREs", "Small teams"],
  sources: ["PAGERDUTY"],
  linkLabels: { PAGERDUTY: "Open in PagerDuty" },
  claimLabels: { PAGERDUTY: "All PagerDuty work" },
  adds: [
    "Your on-call shifts for the next 14 days as calendar events that don't block your time",
    "A task for each triggered or acknowledged incident assigned to you, urgent ones weighted highest",
    "Finished when the incident is resolved, so the goals that claim its service earn for it",
  ],
  keeps:
    "For each shift and incident it tracks: its title, link, times, urgency and service. Never alert details or notes.",
  egress: [PAGERDUTY.egress],
  connect: {
    service: PAGERDUTY,
    makes: ["events", "tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(20)],
  },
};

export default pagerduty;
