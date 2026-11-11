import { PATREON } from "@/lib/connectors/patreon/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const patreon: ModuleManifest = {
  id: "patreon",
  name: "Patreon",
  summary: "How many patrons your Patreon campaign has, read every 6 hours.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: ["Creators", "Podcasters", "Artists"],
  sources: [],
  adds: [
    "Your patron count as a daily number",
    "Its history, so you can see it grow",
    "A count in the top bar, if you want one",
  ],
  keeps: "Each day's patron count. No patron names, emails or pledges.",
  egress: [PATREON.egress],
  connect: {
    service: PATREON,
    makes: ["readings"],
    everyMinutes: 360,
    settings: [STATUS_FIELD],
  },
};

export default patreon;
