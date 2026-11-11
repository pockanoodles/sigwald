import { BEEHIIV } from "@/lib/connectors/beehiiv/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const beehiiv: ModuleManifest = {
  id: "beehiiv",
  name: "beehiiv",
  summary:
    "Your beehiiv drafts as tasks to finish, scheduled sends on the calendar, and your active subscribers as a daily number.",
  defaultOn: false,
  beta: true,
  shelf: "writing",
  madeFor: ["Newsletter writers", "Creators", "Independent publishers"],
  sources: ["BEEHIIV"],
  linkLabels: { BEEHIIV: "Open in beehiiv" },
  claimLabels: { BEEHIIV: "All beehiiv drafts" },
  adds: [
    "A task for each draft, finished when you schedule or send it",
    "A calendar event at the time each scheduled post sends",
    "Your active subscribers, read every few hours",
  ],
  keeps:
    "For each draft and scheduled post: its title, link and send time. Never the text of a post, and no subscriber details.",
  egress: [BEEHIIV.egress],
  connect: {
    service: BEEHIIV,
    makes: ["tasks", "events", "readings"],
    everyMinutes: 60,
    settings: [maxOpenField(20), STATUS_FIELD],
  },
};

export default beehiiv;
