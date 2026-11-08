import type { ModuleManifest } from "@/modules/types";

const training: ModuleManifest = {
  id: "training",
  name: "Training",
  summary:
    "The workouts you repeat: a schedule for each, a session in Today when one is due, and what you lifted last time.",
  defaultOn: false,
  beta: true,
  page: {
    href: "/training",
    keywords: [
      "training",
      "gym",
      "workout",
      "exercise",
      "lifting",
      "run",
      "fitness",
    ],
  },
  sources: ["TRAINING"],
  claimLabels: { TRAINING: "All workouts (Training)" },
  adds: [
    "A workout task when a routine is due, ranked like any other work",
    "The Training page: your routines, each session's sets, reps and weights, and the history",
    "Workouts a goal can claim, a routine at a time, so training counts toward it",
  ],
  keeps:
    "The routines you set up, how often you do each, and every session you log.",
  egress: [],
};

export default training;
