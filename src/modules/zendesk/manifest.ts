import { ZENDESK } from "@/lib/connectors/zendesk/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const zendesk: ModuleManifest = {
  id: "zendesk",
  name: "Zendesk tickets",
  summary:
    "The support tickets assigned to you in Zendesk, ranked by their priority and due when a task ticket says.",
  defaultOn: false,
  beta: true,
  shelf: "clients",
  madeFor: ["Support agents", "Customer success", "Small teams"],
  sources: ["ZENDESK"],
  linkLabels: { ZENDESK: "Open in Zendesk" },
  claimLabels: { ZENDESK: "All Zendesk work" },
  adds: [
    "A task for each ticket assigned to you that is not solved, with its priority as its weight in Focus",
    "Due on a task ticket's due date",
    "Solving a ticket in Zendesk finishes its task here",
  ],
  keeps:
    "For each ticket assigned to you: its number, subject, link, status, type, priority and due date. Not its messages or who wrote them.",
  egress: [ZENDESK.egress],
  connect: {
    service: ZENDESK,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(30)],
  },
};

export default zendesk;
