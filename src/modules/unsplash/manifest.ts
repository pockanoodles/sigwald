import { UNSPLASH } from "@/lib/connectors/unsplash/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const unsplash: ModuleManifest = {
  id: "unsplash",
  name: "Unsplash",
  summary:
    "Your Unsplash photo downloads and views over the last 30 days, and your downloads of all time, as numbers.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: ["Photographers", "Visual artists"],
  sources: [],
  adds: [
    "Downloads and views over the last 30 days, read every 6 hours",
    "Your downloads of all time",
    "A count in the top bar, if you want one",
  ],
  keeps: "Each day's download and view counts. Nothing about who downloaded.",
  egress: [UNSPLASH.egress],
  connect: {
    service: UNSPLASH,
    makes: ["readings"],
    everyMinutes: 360,
    settings: [STATUS_FIELD],
  },
};

export default unsplash;
