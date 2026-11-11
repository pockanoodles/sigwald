import { HUBSPOT } from "@/lib/connectors/hubspot/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const hubspot: ModuleManifest = {
  id: "hubspot",
  name: "HubSpot tasks",
  summary:
    "The CRM tasks assigned to you in HubSpot, ranked by their priority and due when HubSpot says.",
  defaultOn: false,
  beta: true,
  shelf: "clients",
  madeFor: ["Sales reps", "Account managers", "Founders"],
  sources: ["HUBSPOT"],
  linkLabels: { HUBSPOT: "Open in HubSpot" },
  claimLabels: { HUBSPOT: "All HubSpot work" },
  adds: [
    "A task for each open HubSpot task assigned to you, with its priority as its weight in Focus",
    "Due at the time HubSpot gives it, with calls and emails marked in the title",
    "Finishing a task in HubSpot finishes it here",
  ],
  keeps:
    "For each task assigned to you: its subject, notes, type, status, priority and due time.",
  egress: [HUBSPOT.egress],
  connect: {
    service: HUBSPOT,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(30)],
  },
};

export default hubspot;
