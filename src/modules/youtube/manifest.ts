import { YOUTUBE } from "@/lib/connectors/youtube/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const youtube: ModuleManifest = {
  id: "youtube",
  name: "YouTube",
  summary:
    "Your channel's subscribers, total views and video count as numbers, and the views on your newest upload.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: ["Video creators", "Channel managers"],
  sources: [],
  adds: [
    "Subscribers, total views and videos, read every 6 hours",
    "The views on your newest upload",
    "A count in the top bar, if you want one",
  ],
  keeps:
    "Each day's channel counts and the newest upload's views. No comments or analytics.",
  egress: [YOUTUBE.egress],
  connect: {
    service: YOUTUBE,
    makes: ["readings"],
    everyMinutes: 360,
    settings: [STATUS_FIELD],
  },
};

export default youtube;
