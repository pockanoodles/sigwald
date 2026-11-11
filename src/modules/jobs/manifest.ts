import { JOB_BOARDS } from "@/lib/connectors/jobboards/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const jobs: ModuleManifest = {
  id: "jobs",
  name: "Job boards",
  summary:
    "New openings at the companies you follow, matched to your words, as tasks to apply to. Reads the Greenhouse, Lever and Ashby boards most careers pages run on.",
  defaultOn: false,
  beta: true,
  shelf: "people",
  madeFor: [
    "Job seekers",
    "Students hunting internships and co-ops",
    "Recruiters",
  ],
  sources: ["JOBS"],
  linkLabels: { JOBS: "Open the posting" },
  claimLabels: { JOBS: "All job applications" },
  adds: [
    'An "Apply" task for each opening that matches your words and places',
    "A posting taken down closes its task, so dead openings don't linger",
    "Each company a goal can claim, so applying counts toward it",
  ],
  keeps:
    "The boards and words you set, and for each matching opening its title, place, team, link and when it was posted.",
  egress: [JOB_BOARDS.egress],
  connect: {
    service: JOB_BOARDS,
    makes: ["tasks"],
    everyMinutes: 180,
    taskCategory: "PERSONAL",
    settings: [
      {
        kind: "list",
        key: "boards",
        label: "Boards",
        help: "One per line, as kind:name from the careers page's address: greenhouse:stripe, lever:palantir, ashby:linear.",
        placeholder: "greenhouse:stripe",
        maxItems: 30,
        itemPattern: {
          source: "(greenhouse|lever|ashby):[A-Za-z0-9._-]+",
          message: "write it as greenhouse:name, lever:name or ashby:name",
        },
      },
      {
        kind: "list",
        key: "words",
        label: "Titles with",
        help: "Any of these in the title matches: intern, new grad, designer, staff.",
        placeholder: "new grad",
        maxItems: 20,
      },
      {
        kind: "list",
        key: "places",
        label: "Places",
        help: "Any of these in the location matches; remote matches remote roles. Empty takes everywhere.",
        placeholder: "Boston",
        optional: true,
        maxItems: 20,
      },
      maxOpenField(25),
    ],
  },
};

export default jobs;
