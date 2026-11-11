import { CLICKUP } from "@/lib/connectors/clickup/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const clickup: ModuleManifest = {
  id: "clickup",
  name: "ClickUp",
  summary:
    "The ClickUp tasks assigned to you, ranked by their priority and due by their due date, finished when you close them there.",
  defaultOn: false,
  beta: true,
  shelf: "projects",
  madeFor: ["Teams on ClickUp", "Project managers", "Freelancers"],
  sources: ["CLICKUP"],
  linkLabels: { CLICKUP: "Open in ClickUp" },
  claimLabels: { CLICKUP: "All ClickUp work" },
  adds: [
    "A task for each open ClickUp task assigned to you, with its priority as its weight in Focus",
    "Due by the task's due date, and finished when you close it in ClickUp",
    "Lists a goal can claim, so finishing a list's work counts toward it",
  ],
  keeps:
    "For each task assigned to you: its name, link, status, priority, due date, list and folder.",
  egress: [CLICKUP.egress],
  connect: {
    service: CLICKUP,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [
      {
        kind: "text",
        key: "team",
        label: "Workspace id",
        help: "Leave empty to read your first workspace. The id is the number in a ClickUp web address.",
        placeholder: "9012345",
        optional: true,
        pattern: { source: "[0-9]{1,20}", message: "a number" },
      },
      maxOpenField(30),
    ],
  },
};

export default clickup;
