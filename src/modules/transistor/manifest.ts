import { TRANSISTOR } from "@/lib/connectors/transistor/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const transistor: ModuleManifest = {
  id: "transistor",
  name: "Transistor",
  summary:
    "Draft podcast episodes as tasks that finish when you publish them, scheduled episodes on your calendar, and your downloads as a number.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: ["Podcasters", "Podcast producers", "Show editors"],
  sources: ["TRANSISTOR"],
  linkLabels: { TRANSISTOR: "Open on Transistor" },
  claimLabels: { TRANSISTOR: "All Transistor episodes" },
  adds: [
    "A task, Finish episode, for each draft, done when the episode is published",
    "Each scheduled episode on your calendar at its release time, as free time",
    "Downloads over the last 30 days, and a count in the top bar if you want one",
  ],
  keeps:
    "For each draft or scheduled episode: its title, link, show and release time. Each day's download count. Never audio.",
  egress: [TRANSISTOR.egress],
  connect: {
    service: TRANSISTOR,
    makes: ["tasks", "events", "readings"],
    everyMinutes: 60,
    settings: [
      {
        kind: "text",
        key: "show",
        label: "Only this show",
        help: "A show's id or slug from its Transistor address. Empty means every show.",
        optional: true,
        pattern: {
          source: "[A-Za-z0-9_-]+",
          message: "a show id or slug, with no spaces",
        },
      },
      maxOpenField(30),
      STATUS_FIELD,
    ],
  },
};

export default transistor;
