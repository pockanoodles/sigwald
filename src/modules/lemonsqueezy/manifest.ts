import { LEMONSQUEEZY } from "@/lib/connectors/lemonsqueezy/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const lemonsqueezy: ModuleManifest = {
  id: "lemonsqueezy",
  name: "Lemon Squeezy",
  summary:
    "Your stores' revenue and sales, all time and over the last 30 days, as numbers.",
  defaultOn: false,
  beta: true,
  shelf: "money",
  madeFor: ["Indie hackers", "Software sellers", "Creators"],
  sources: [],
  adds: [
    "Revenue over the last 30 days and all time, in US dollars",
    "Sales over the last 30 days and all time",
    "A figure in the top bar, if you want one",
  ],
  keeps:
    "Each day's revenue and sales totals across your stores. No customers, orders or products.",
  egress: [LEMONSQUEEZY.egress],
  connect: {
    service: LEMONSQUEEZY,
    makes: ["readings"],
    everyMinutes: 360,
    headline: "revenue_30d",
    settings: [STATUS_FIELD],
  },
};

export default lemonsqueezy;
