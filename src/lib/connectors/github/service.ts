import type { ServiceManifest } from "@/lib/connectors/types";

export const GITHUB: ServiceManifest = {
  id: "github",
  name: "GitHub",
  homepage: "https://github.com",
  tokenHelp: {
    text: "Make a fine-grained token with read-only access to Issues, Pull requests and Metadata on the repositories you want. A classic token with the repo scope works too.",
    url: "https://github.com/settings/personal-access-tokens/new",
  },
  fields: [
    {
      key: "token",
      label: "Token",
      kind: "secret",
      placeholder: "github_pat_… or ghp_…",
      pattern: {
        source: "(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}",
        message: "A GitHub token starts with github_pat_ or ghp_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.github.com"] },
  egress: {
    to: "GitHub (api.github.com)",
    sends:
      "Your GitHub token, with searches for the issues and pull requests that involve you",
    why: "To read the reviews waiting on you and the issues assigned to you, and see when they're done. Nothing is written back.",
  },
};
