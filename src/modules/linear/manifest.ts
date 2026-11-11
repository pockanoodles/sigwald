import { LINEAR } from "@/lib/connectors/linear/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const linear: ModuleManifest = {
  id: "linear",
  name: "Linear",
  summary:
    "The issues assigned to you in Linear, ranked by their priority and due by their due date or cycle's end.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["Engineers", "Product teams", "Startups"],
  sources: ["LINEAR"],
  linkLabels: { LINEAR: "Open in Linear" },
  claimLabels: { LINEAR: "All Linear work" },
  adds: [
    "A task for each open issue assigned to you, with its priority as its weight in Focus",
    "Due by the issue's due date, or by the end of its cycle",
    "Teams and projects a goal can claim, so shipping a project counts toward it",
  ],
  keeps:
    "For each issue assigned to you: its identifier, title, link, state, priority, team, project, cycle and labels.",
  egress: [LINEAR.egress],
  connect: {
    service: LINEAR,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [
      {
        kind: "toggle",
        key: "cycleDue",
        label: "Due by the cycle's end",
        help: "For an issue with no due date of its own.",
        default: true,
      },
      {
        kind: "list",
        key: "teams",
        label: "Only these teams",
        help: "Team keys, one per line (ENG). Empty means every team.",
        placeholder: "ENG",
        optional: true,
        itemPattern: {
          source: "[A-Za-z0-9]{1,10}",
          message: "a team key, like ENG",
        },
      },
      maxOpenField(30),
    ],
  },
};

export default linear;
