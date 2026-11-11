import { YNAB } from "@/lib/connectors/ynab/service";

import { STATUS_FIELD, maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const ynab: ModuleManifest = {
  id: "ynab",
  name: "YNAB",
  summary:
    "Ready to Assign and age of money as numbers, a task to approve waiting transactions, and a task to cover each overspent category.",
  defaultOn: false,
  beta: true,
  shelf: "money",
  madeFor: ["Budgeters", "Households", "Anyone who gives every dollar a job"],
  sources: ["YNAB"],
  linkLabels: { YNAB: "Open YNAB" },
  claimLabels: { YNAB: "All YNAB budget work" },
  adds: [
    "Ready to Assign and age of money, read every 6 hours",
    "One task to approve your unapproved transactions, done when none are left",
    "A task to cover each category that is overspent this month",
  ],
  keeps:
    "Each day's Ready to Assign and age of money, and the names of overspent categories. No payees, accounts or transactions.",
  egress: [YNAB.egress],
  connect: {
    service: YNAB,
    makes: ["tasks", "readings"],
    everyMinutes: 360,
    headline: "ready_to_assign",
    settings: [
      {
        kind: "text",
        key: "budget",
        label: "Budget",
        help: "A budget id from the address of your budget in YNAB. Empty reads the one you used last.",
        default: "last-used",
        optional: true,
        placeholder: "last-used",
        pattern: {
          source: "last-used|default|[0-9a-fA-F-]{36}",
          message: "last-used, or a budget id like 1c3a…",
        },
      },
      maxOpenField(20),
      STATUS_FIELD,
    ],
    maxOpen: 20,
  },
};

export default ynab;
