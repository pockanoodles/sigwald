import type { ServiceManifest } from "@/lib/connectors/types";

export const CLOCKIFY: ServiceManifest = {
  id: "clockify",
  name: "Clockify",
  homepage: "https://clockify.me",
  tokenHelp: {
    text: "Generate an API key under Preferences, then Advanced, in your Clockify profile settings. It is tied to your user and Clockify has no read-only version, so Sigwald only ever reads.",
    url: "https://app.clockify.me/user/preferences#advanced",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.clockify.me"] },
  egress: {
    to: "Clockify (api.clockify.me)",
    sends:
      "Your API key, with requests for who you are and your time entries from the past week",
    why: "To show the hours you tracked today and this week. Nothing is written back.",
  },
};
