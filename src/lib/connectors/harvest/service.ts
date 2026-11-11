import type { ServiceManifest } from "@/lib/connectors/types";

export const HARVEST: ServiceManifest = {
  id: "harvest",
  name: "Harvest",
  homepage: "https://www.getharvest.com",
  tokenHelp: {
    text: "Make a personal access token under Developers in Harvest ID, and copy your account id from the same page. A personal access token reaches everything you can see in Harvest, so Sigwald only ever reads. Invoices show only for Administrators and Managers.",
    url: "https://id.getharvest.com/developers",
  },
  fields: [
    {
      key: "token",
      label: "Personal access token",
      kind: "secret",
    },
    {
      key: "accountId",
      label: "Account id",
      kind: "text",
      placeholder: "1234567",
      help: "The number shown beside your token on the Developers page.",
      pattern: { source: "[0-9]{3,12}", message: "Use the number only" },
    },
  ],
  host: { kind: "fixed", hosts: ["api.harvestapp.com"] },
  egress: {
    to: "Harvest (api.harvestapp.com)",
    sends:
      "Your token and account id, with requests for your time entries this week and your open invoices",
    why: "To show the hours you logged and make a task for each invoice that is past due. Nothing is written back.",
  },
};
