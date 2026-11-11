import type { ServiceManifest } from "@/lib/connectors/types";

export const WANIKANI: ServiceManifest = {
  id: "wanikani",
  name: "WaniKani",
  homepage: "https://www.wanikani.com",
  tokenHelp: {
    text: "Make a personal access token in WaniKani under Settings, API Tokens. Leave every permission box unticked: a token with none can still read your summary and level.",
    url: "https://www.wanikani.com/settings/personal_access_tokens",
  },
  fields: [
    {
      key: "token",
      label: "API token",
      kind: "secret",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      pattern: {
        source:
          "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        message: "A WaniKani token is 36 characters with dashes",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.wanikani.com"] },
  egress: {
    to: "WaniKani (api.wanikani.com)",
    sends:
      "Your API token, with requests for your level and your summary of lessons and reviews",
    why: "To make a task for the lessons and reviews waiting each day, finish it once none are left, and show your level. Nothing is written back.",
  },
};
