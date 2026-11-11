import { WANIKANI } from "@/lib/connectors/wanikani/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const wanikani: ModuleManifest = {
  id: "wanikani",
  name: "WaniKani",
  summary:
    "The WaniKani reviews and lessons waiting for you each day, as a task that closes when you have cleared them, with your level as a number.",
  defaultOn: false,
  beta: true,
  shelf: "learning",
  madeFor: ["Japanese learners", "Kanji students"],
  sources: ["WANIKANI"],
  linkLabels: { WANIKANI: "Open in WaniKani" },
  claimLabels: { WANIKANI: "All WaniKani study" },
  adds: [
    "A task each day for the reviews waiting, done once there are none",
    "A task each day for the lessons waiting, done once there are none",
    "Your level, reviews waiting and lessons waiting as numbers",
  ],
  keeps:
    "Each day's count of reviews and lessons waiting, and your level. No answers and no item lists.",
  egress: [WANIKANI.egress],
  connect: {
    service: WANIKANI,
    makes: ["tasks", "readings"],
    everyMinutes: 60,
    headline: "reviews",
    settings: [maxOpenField(6), STATUS_FIELD],
  },
};

export default wanikani;
