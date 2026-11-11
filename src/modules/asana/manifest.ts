import { ASANA } from "@/lib/connectors/asana/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const asana: ModuleManifest = {
  id: "asana",
  name: "Asana",
  summary:
    "Tasks assigned to you in Asana, with their due dates, that finish themselves when you complete them there.",
  defaultOn: false,
  beta: true,
  shelf: "projects",
  madeFor: ["Project teams", "Managers", "Cross-functional work"],
  sources: ["ASANA"],
  linkLabels: { ASANA: "Open in Asana" },
  claimLabels: { ASANA: "All Asana work" },
  adds: [
    "A task for each incomplete Asana task assigned to you, with its due date",
    "Finished when you complete it in Asana, so the goals that claim its project earn for it",
    "Projects a goal can claim, named as they are in Asana",
  ],
  keeps:
    "For each task it tracks: its name, link, due date and projects. Never notes, comments or attachments.",
  egress: [ASANA.egress],
  connect: {
    service: ASANA,
    makes: ["tasks"],
    everyMinutes: 15,
    taskCategory: "WORK",
    settings: [
      {
        kind: "text",
        key: "workspace",
        label: "Workspace id",
        help: "Empty uses the first workspace your account is in.",
        placeholder: "1200000000000000",
        optional: true,
        pattern: { source: "[0-9]+", message: "A workspace id is only digits" },
      },
      maxOpenField(30),
    ],
  },
};

export default asana;
