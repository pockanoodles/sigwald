import { PLAUSIBLE } from "@/lib/connectors/plausible/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const plausible: ModuleManifest = {
  id: "plausible",
  name: "Plausible",
  summary:
    "Visitors today, and visitors, pageviews and bounce rate over the last 30 days, from Plausible or your own install.",
  defaultOn: false,
  beta: true,
  shelf: "goals",
  madeFor: ["Founders", "Writers", "Indie hackers"],
  sources: [],
  adds: [
    "Visitors today as a number you can put in the top bar",
    "Visitors and pageviews over the last 30 days",
    "Bounce rate over 30 days, as a percent",
  ],
  keeps:
    "Each day's counts of visitors and pageviews and the bounce rate. No pages, sources or visitor details.",
  egress: [PLAUSIBLE.egress],
  connect: {
    service: PLAUSIBLE,
    makes: ["readings"],
    everyMinutes: 360,
    headline: "visitors_today",
    settings: [STATUS_FIELD],
  },
};

export default plausible;
