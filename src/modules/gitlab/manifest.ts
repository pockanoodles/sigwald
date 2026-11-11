import { GITLAB } from "@/lib/connectors/gitlab/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const gitlab: ModuleManifest = {
  id: "gitlab",
  name: "GitLab",
  summary:
    "Merge requests waiting on your review and issues assigned to you, as tasks that finish themselves when the work is done on GitLab.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["Engineers", "Reviewers", "Self-hosted teams"],
  sources: ["GITLAB"],
  linkLabels: { GITLAB: "Open on GitLab" },
  claimLabels: { GITLAB: "All GitLab work" },
  adds: [
    "A task for each merge request waiting on your review and each issue assigned to you",
    "Finished when you review, merge or close it on GitLab, so the goals that claim its project earn for it",
    "Works on gitlab.com and on a GitLab you host yourself",
  ],
  keeps:
    "For each issue and merge request it tracks: its title, link, labels, milestone and state. Never code.",
  egress: [GITLAB.egress],
  connect: {
    service: GITLAB,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [
      {
        kind: "toggle",
        key: "reviews",
        label: "Reviews waiting on you",
        default: true,
      },
      {
        kind: "toggle",
        key: "issues",
        label: "Issues assigned to you",
        default: true,
      },
      {
        kind: "toggle",
        key: "mine",
        label: "Your own open merge requests",
        default: false,
      },
      maxOpenField(30),
    ],
  },
};

export default gitlab;
