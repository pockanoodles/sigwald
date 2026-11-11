import { STRIPE } from "@/lib/connectors/stripe/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const stripe: ModuleManifest = {
  id: "stripe",
  name: "Stripe",
  summary:
    "Your balance, recurring revenue and last month's charges as numbers, and every dispute that needs an answer as a task due by Stripe's deadline.",
  defaultOn: false,
  beta: true,
  shelf: "money",
  madeFor: ["Founders", "Indie hackers", "Online sellers"],
  sources: ["STRIPE"],
  linkLabels: { STRIPE: "Open in Stripe" },
  claimLabels: { STRIPE: "All Stripe disputes" },
  adds: [
    "A task for each dispute that needs your answer, due when Stripe stops taking evidence",
    "Balance, monthly recurring revenue and the last 30 days of charges, read every hour",
    "A count in the top bar, if you want one",
  ],
  keeps:
    "Each day's balance, recurring revenue and charge total, and for each open dispute its amount, reason and deadline. No customer details.",
  egress: [STRIPE.egress],
  connect: {
    service: STRIPE,
    makes: ["tasks", "readings"],
    everyMinutes: 60,
    headline: "mrr",
    settings: [
      {
        kind: "text",
        key: "currency",
        label: "Currency",
        help: "The one to count in, as its three-letter code.",
        default: "usd",
        pattern: {
          source: "[A-Za-z]{3}",
          message: "a three-letter code, like usd",
        },
      },
      {
        kind: "toggle",
        key: "disputes",
        label: "Disputes as tasks",
        default: true,
      },
      {
        kind: "toggle",
        key: "mrr",
        label: "Monthly recurring revenue",
        help: "From active subscriptions at their list prices, before discounts.",
        default: true,
      },
      {
        kind: "toggle",
        key: "volume",
        label: "Charges in the last 30 days",
        default: true,
      },
      STATUS_FIELD,
    ],
    maxOpen: 50,
  },
};

export default stripe;
