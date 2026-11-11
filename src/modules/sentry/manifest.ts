import { SENTRY } from "@/lib/connectors/sentry/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const sentry: ModuleManifest = {
  id: "sentry",
  name: "Sentry",
  summary:
    "Unresolved Sentry issues assigned to you, as tasks that finish themselves when the issue is resolved.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["Engineers", "On-call developers", "Small teams"],
  sources: ["SENTRY"],
  linkLabels: { SENTRY: "Open in Sentry" },
  claimLabels: { SENTRY: "All Sentry work" },
  adds: [
    "A task named Fix for each unresolved issue assigned to you, weighted by its level",
    "Finished when the issue is resolved in Sentry, so the goals that claim its project earn for it",
    "Facts on each task: project, event count, users hit, first and last seen",
  ],
  keeps:
    "For each issue it tracks: its title, link, level, project, counts and when it was first and last seen. Never events, stack traces or user details.",
  egress: [SENTRY.egress],
  connect: {
    service: SENTRY,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(20)],
  },
};

export default sentry;
