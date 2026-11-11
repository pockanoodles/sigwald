import type { ServiceManifest } from "@/lib/connectors/types";

export const NOTION: ServiceManifest = {
  id: "notion",
  name: "Notion",
  homepage: "https://www.notion.so",
  tokenHelp: {
    text: "Make an internal integration with only the Read content capability, copy its token, then open each database you want, choose Connections and add the integration. It sees nothing you haven't shared with it.",
    url: "https://www.notion.so/profile/integrations",
  },
  fields: [
    {
      key: "token",
      label: "Integration token",
      kind: "secret",
      placeholder: "ntn_…",
      pattern: {
        source: "(ntn_|secret_)[A-Za-z0-9]{20,}",
        message: "A Notion token starts with ntn_ or secret_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.notion.com"] },
  readsWithPost:
    "Notion answers a database's rows only to a POST query; Sigwald sends it only database queries that change nothing.",
  egress: {
    to: "Notion (api.notion.com)",
    sends:
      "Your integration token, with requests for the databases you named and their rows",
    why: "To read the rows of those databases as tasks, with their dates and done marks. Nothing is written back.",
  },
};
