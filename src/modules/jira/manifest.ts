import { JIRA } from "@/lib/connectors/jira/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const jira: ModuleManifest = {
  id: "jira",
  name: "Jira",
  summary:
    "Issues assigned to you in Jira Cloud, as tasks with their priority and due date that finish themselves when the issue is done.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["Engineers", "Product teams", "Project managers"],
  sources: ["JIRA"],
  linkLabels: { JIRA: "Open in Jira" },
  claimLabels: { JIRA: "All Jira work" },
  adds: [
    "A task for each open issue assigned to you, with its priority and due date",
    "Finished when the issue reaches a Done status in Jira, so the goals that claim its project earn for it",
    "Projects a goal can claim by their key",
  ],
  keeps:
    "For each issue it tracks: its key, summary, link, priority, status, labels and due date. Never the description or comments.",
  egress: [JIRA.egress],
  connect: {
    service: JIRA,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(30)],
  },
};

export default jira;
