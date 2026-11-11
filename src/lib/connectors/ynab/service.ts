import type { ServiceManifest } from "@/lib/connectors/types";

export const YNAB: ServiceManifest = {
  id: "ynab",
  name: "YNAB",
  homepage: "https://www.ynab.com",
  tokenHelp: {
    text: "Make a personal access token under Developer Settings in your YNAB account settings. YNAB has no read-only token, so it reaches everything in your budget, but Sigwald only ever reads.",
    url: "https://app.ynab.com/settings/developer",
  },
  fields: [
    {
      key: "token",
      label: "Personal access token",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.ynab.com"] },
  egress: {
    to: "YNAB (api.ynab.com)",
    sends:
      "Your token, with requests for your budget's currency, this month's category balances and your unapproved transactions",
    why: "To show Ready to Assign and age of money, and to make a task for unapproved transactions and for each overspent category. Nothing is written back.",
  },
};
