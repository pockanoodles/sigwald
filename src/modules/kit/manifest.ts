import { KIT } from "@/lib/connectors/kit/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const kit: ModuleManifest = {
  id: "kit",
  name: "Kit",
  summary:
    "Your Kit (formerly ConvertKit) draft broadcasts as tasks to finish, scheduled sends on the calendar, and your active subscribers as a daily number.",
  defaultOn: false,
  beta: true,
  shelf: "writing",
  madeFor: ["Newsletter writers", "Creators", "Course sellers"],
  sources: ["KIT"],
  linkLabels: { KIT: "Open in Kit" },
  claimLabels: { KIT: "All Kit drafts" },
  adds: [
    "A task for each draft broadcast, finished when it is sent",
    "A calendar event at the time each scheduled broadcast goes out",
    "Your active subscribers, read every few hours",
  ],
  keeps:
    "For each draft and scheduled broadcast: its subject and send time. Never the text of a broadcast, and no subscriber details.",
  egress: [KIT.egress],
  connect: {
    service: KIT,
    makes: ["tasks", "events", "readings"],
    everyMinutes: 60,
    settings: [maxOpenField(20), STATUS_FIELD],
  },
};

export default kit;
