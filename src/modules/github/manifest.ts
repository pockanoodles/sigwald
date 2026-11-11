import { GITHUB } from "@/lib/connectors/github/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const REPO = {
  source: "[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+",
  message: "write it as owner/name",
};

const github: ModuleManifest = {
  id: "github",
  name: "GitHub",
  summary:
    "Pull requests waiting on your review and issues assigned to you, as tasks that finish themselves when the work is done on GitHub.",
  defaultOn: false,
  beta: true,
  shelf: "engineering",
  madeFor: ["Engineers", "Open-source maintainers", "Reviewers"],
  sources: ["GITHUB"],
  linkLabels: { GITHUB: "Open on GitHub" },
  claimLabels: { GITHUB: "All GitHub work" },
  adds: [
    "A task for each pull request waiting on your review and each issue assigned to you",
    "Finished when you review, merge or close it on GitHub, so the goals that claim its repo earn for it",
    "Repos a goal can claim: the same keys the Code module's commit days count toward",
  ],
  keeps:
    "For each issue and pull request it tracks: its title, link, labels, milestone and state. Never code.",
  egress: [GITHUB.egress],
  connect: {
    service: GITHUB,
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
        key: "teams",
        label: "Count reviews asked of your teams",
        help: "Off: only pull requests that ask you by name.",
        default: false,
      },
      {
        kind: "toggle",
        key: "issues",
        label: "Issues assigned to you",
        default: true,
      },
      {
        kind: "toggle",
        key: "changes",
        label: "Your pull requests with changes requested",
        default: false,
      },
      {
        kind: "list",
        key: "only",
        label: "Only these repos",
        help: "One owner/name per line. Empty means every repo.",
        placeholder: "pockanoodles/sigwald",
        optional: true,
        itemPattern: REPO,
      },
      {
        kind: "list",
        key: "skip",
        label: "Leave out these repos",
        placeholder: "owner/name",
        optional: true,
        itemPattern: REPO,
      },
      maxOpenField(30),
    ],
  },
};

export default github;
