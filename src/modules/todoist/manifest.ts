import { TODOIST } from "@/lib/connectors/todoist/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const todoist: ModuleManifest = {
  id: "todoist",
  name: "Todoist",
  summary:
    "Your active Todoist tasks, ranked by their priority and due by their due date, finished when you check them off there.",
  defaultOn: false,
  beta: true,
  shelf: "projects",
  madeFor: ["Todoist users", "Students", "Freelancers"],
  sources: ["TODOIST"],
  linkLabels: { TODOIST: "Open in Todoist" },
  claimLabels: { TODOIST: "All Todoist work" },
  adds: [
    "A task for each active Todoist task that is yours or unassigned, with its priority as its weight in Focus",
    "Due by its deadline if it has one, otherwise its due date or time",
    "Projects a goal can claim, so finishing a project's tasks counts toward it",
  ],
  keeps:
    "For each task: its name, description, link, priority, labels, due date, deadline and project.",
  egress: [TODOIST.egress],
  connect: {
    service: TODOIST,
    makes: ["tasks"],
    everyMinutes: 15,
    taskCategory: "PERSONAL",
    settings: [maxOpenField(30)],
  },
};

export default todoist;
