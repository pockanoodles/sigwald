import { HARVEST } from "@/lib/connectors/harvest/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const harvest: ModuleManifest = {
  id: "harvest",
  name: "Harvest",
  summary:
    "The hours you logged today and this week as numbers, and every invoice past its due date as a task to chase.",
  defaultOn: false,
  beta: true,
  shelf: "money",
  madeFor: ["Freelancers", "Consultants", "Small agencies"],
  sources: ["HARVEST"],
  linkLabels: { HARVEST: "Open in Harvest" },
  claimLabels: { HARVEST: "All Harvest invoices" },
  adds: [
    "Hours today, hours this week and billable hours this week",
    "A task for each open invoice past its due date, due on that date",
    "The task is done once the invoice is paid or closed",
  ],
  keeps:
    "Each day's hour totals, and for each overdue invoice its number, client and amount. No time entry notes.",
  egress: [HARVEST.egress],
  connect: {
    service: HARVEST,
    makes: ["tasks", "readings"],
    everyMinutes: 60,
    headline: "hours_today",
    settings: [maxOpenField(20), STATUS_FIELD],
    maxOpen: 20,
  },
};

export default harvest;
