import { PIPEDRIVE } from "@/lib/connectors/pipedrive/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const pipedrive: ModuleManifest = {
  id: "pipedrive",
  name: "Pipedrive activities",
  summary:
    "The calls, meetings, tasks and deadlines assigned to you in Pipedrive, due when Pipedrive says.",
  defaultOn: false,
  beta: true,
  shelf: "clients",
  madeFor: ["Sales reps", "Account managers", "Small agencies"],
  sources: ["PIPEDRIVE"],
  linkLabels: { PIPEDRIVE: "Open in Pipedrive" },
  claimLabels: { PIPEDRIVE: "All Pipedrive work" },
  adds: [
    "A task for each activity of yours that is not done, with its type in the title",
    "Due at its due time, or by the end of its due day, with its length as the time it takes",
    "Marking an activity done in Pipedrive finishes it here",
  ],
  keeps:
    "For each activity: its subject, type, due date and time, length, note, and the names of its deal, person and organization.",
  egress: [PIPEDRIVE.egress],
  connect: {
    service: PIPEDRIVE,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(30)],
  },
};

export default pipedrive;
