import type { ModuleManifest } from "@/modules/types";

const code: ModuleManifest = {
  id: "code",
  name: "Code",
  summary:
    "Your commits, read as finished work: each day you commit to a repo is a done task that a goal can claim.",
  defaultOn: false,
  beta: true,
  sources: ["CODE"],
  claimLabels: { CODE: "All code work" },
  adds: [
    "A finished task for each day you commit to a repo, with that day's commit messages",
    "Repos and GitHub owners a goal can claim, so the days you ship count toward it",
  ],
  keeps:
    "For each repo and day you committed: how many commits and their one-line messages. Sent in by a script that reads your repos (ops' worklog pump); Sigwald never reads your code.",
  egress: [],
};

export default code;
