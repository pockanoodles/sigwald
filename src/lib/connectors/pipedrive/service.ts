import type { ServiceManifest } from "@/lib/connectors/types";

export const PIPEDRIVE: ServiceManifest = {
  id: "pipedrive",
  name: "Pipedrive",
  homepage: "https://www.pipedrive.com",
  tokenHelp: {
    text: "Copy your personal API token from Pipedrive under Personal preferences, API. It reads whatever your own login can read, so Sigwald only asks for your own activities.",
    url: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",
  },
  fields: [
    {
      key: "token",
      label: "API token",
      kind: "secret",
      placeholder: "40 letters and numbers",
      pattern: {
        source: "[A-Za-z0-9]{20,}",
        message: "A Pipedrive API token is letters and numbers only",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.pipedrive.com"] },
  egress: {
    to: "Pipedrive (api.pipedrive.com)",
    sends:
      "Your API token, with requests for the activities assigned to you and the names of the deals, people and organizations they belong to",
    why: "To read your open calls, meetings, tasks and deadlines with their due times, and see when they're done. Nothing is written back.",
  },
};
