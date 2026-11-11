import type { ServiceManifest } from "@/lib/connectors/types";

export const GITLAB: ServiceManifest = {
  id: "gitlab",
  name: "GitLab",
  homepage: "https://gitlab.com",
  tokenHelp: {
    text: "Make a personal access token with the read_api scope only. It can read your issues and merge requests and change nothing. On a self-hosted GitLab, make it at the same page on your own site.",
    url: "https://gitlab.com/-/user_settings/personal_access_tokens",
  },
  fields: [
    {
      key: "site",
      label: "GitLab address",
      kind: "url",
      placeholder: "https://gitlab.com",
      help: "Your own GitLab's address if it is self-hosted.",
    },
    {
      key: "token",
      label: "Access token",
      kind: "secret",
      placeholder: "glpat-…",
    },
  ],
  host: { kind: "site", field: "site" },
  egress: {
    to: "Your GitLab site",
    sends:
      "Your access token, with requests for the issues and merge requests that involve you",
    why: "To read the reviews waiting on you and the issues assigned to you, and see when they're done. Nothing is written back.",
  },
};
