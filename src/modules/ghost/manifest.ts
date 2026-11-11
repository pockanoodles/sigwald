import { GHOST } from "@/lib/connectors/ghost/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const ghost: ModuleManifest = {
  id: "ghost",
  name: "Ghost",
  summary:
    "Your Ghost drafts as tasks to finish, scheduled posts on the calendar, and your member count as a daily number.",
  defaultOn: false,
  beta: true,
  shelf: "writing",
  madeFor: ["Writers", "Newsletter authors", "Independent publishers"],
  sources: ["GHOST"],
  linkLabels: { GHOST: "Open in Ghost" },
  claimLabels: { GHOST: "All Ghost drafts" },
  adds: [
    "A task for each draft, finished when the post is published",
    "A calendar event at the time each scheduled post goes out",
    "Your total members, read every few hours",
  ],
  keeps:
    "For each draft and scheduled post: its title, link and the times it was edited and set to publish. Never the text of a post, and no member details.",
  egress: [GHOST.egress],
  connect: {
    service: GHOST,
    makes: ["tasks", "events", "readings"],
    everyMinutes: 60,
    settings: [maxOpenField(20), STATUS_FIELD],
  },
};

export default ghost;
