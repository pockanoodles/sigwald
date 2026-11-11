import { READWISE } from "@/lib/connectors/readwise/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const readwise: ModuleManifest = {
  id: "readwise",
  name: "Readwise Reader",
  summary:
    "What you saved to read in Reader as tasks with a reading time, finished when you archive them, and how many are waiting.",
  defaultOn: false,
  beta: true,
  shelf: "research",
  madeFor: ["Researchers", "Heavy readers", "Students"],
  sources: ["READWISE"],
  linkLabels: { READWISE: "Open the article" },
  claimLabels: { READWISE: "All Reader reading" },
  adds: [
    "A task, Read, for each document in Later and Shortlist, sized by its reading time",
    "Finished when you archive it in Reader",
    "How many documents wait in Later, and a count in the top bar if you want one",
  ],
  keeps:
    "For each document it tracks: its title, author, site, reading time and link. Never its text or your highlights.",
  egress: [READWISE.egress],
  connect: {
    service: READWISE,
    makes: ["tasks", "readings"],
    everyMinutes: 30,
    settings: [
      {
        kind: "toggle",
        key: "shortlist",
        label: "Include Shortlist",
        default: true,
      },
      maxOpenField(30),
      STATUS_FIELD,
    ],
  },
};

export default readwise;
