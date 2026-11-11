import { BLUESKY } from "@/lib/connectors/bluesky/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const bluesky: ModuleManifest = {
  id: "bluesky",
  name: "Bluesky",
  summary:
    "Your Bluesky followers, following and posts, read every few hours from your public profile, so an audience goal has a number behind it.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: [
    "Writers",
    "Creators",
    "Community managers",
    "Founders building in public",
  ],
  sources: [],
  adds: [
    "Followers, following and posts as numbers in Readouts",
    "Followers in the top bar, if you want",
    "No account and no app password: it reads only what your profile shows anyone",
  ],
  keeps: "Your handle, and each day's follower, following and post counts.",
  egress: [BLUESKY.egress],
  connect: {
    service: BLUESKY,
    makes: ["readings"],
    everyMinutes: 360,
    headline: "followers",
    settings: [
      {
        kind: "text",
        key: "handle",
        label: "Handle",
        placeholder: "you.bsky.social",
        pattern: {
          source: "@?[A-Za-z0-9.-]{3,253}",
          message: "use your handle, like you.bsky.social",
        },
      },
      STATUS_FIELD,
    ],
  },
};

export default bluesky;
