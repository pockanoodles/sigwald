import type { ServiceManifest } from "@/lib/connectors/types";

export const LINEAR: ServiceManifest = {
  id: "linear",
  name: "Linear",
  homepage: "https://linear.app",
  tokenHelp: {
    text: "Make a personal API key in Linear under Settings, Security & access. A key that can only read is enough.",
    url: "https://linear.app/settings/account/security",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
      placeholder: "lin_api_…",
      pattern: {
        source: "lin_api_[A-Za-z0-9]{20,}",
        message: "A Linear API key starts with lin_api_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.linear.app"] },
  readsWithPost:
    "Linear answers everything at one GraphQL address, by POST; Sigwald sends it only queries, and the egress refuses any mutation.",
  egress: {
    to: "Linear (api.linear.app)",
    sends: "Your API key, with queries for the issues assigned to you",
    why: "To read your assigned issues with their priority, due dates and cycles, and see when they're done. Nothing is written back.",
  },
};
