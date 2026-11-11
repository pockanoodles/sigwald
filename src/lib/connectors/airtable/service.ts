import type { ServiceManifest } from "@/lib/connectors/types";

export const AIRTABLE: ServiceManifest = {
  id: "airtable",
  name: "Airtable",
  homepage: "https://airtable.com",
  tokenHelp: {
    text: "Make a personal access token with only the data.records:read scope, and give it access to just the base you want to read.",
    url: "https://airtable.com/create/tokens",
  },
  fields: [
    {
      key: "token",
      label: "Personal access token",
      kind: "secret",
      placeholder: "pat…",
      pattern: {
        source: "pat[A-Za-z0-9._-]{20,}",
        message: "An Airtable token starts with pat",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.airtable.com"] },
  egress: {
    to: "Airtable (api.airtable.com)",
    sends:
      "Your personal access token, with requests for the records of the table you named",
    why: "To read that table's records as tasks, with their due dates and done marks. Nothing is written back.",
  },
};
