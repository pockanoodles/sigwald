import type { ServiceManifest } from "@/lib/connectors/types";

export const UNSPLASH: ServiceManifest = {
  id: "unsplash",
  name: "Unsplash",
  homepage: "https://unsplash.com",
  tokenHelp: {
    text: "Register an application on Unsplash and copy its Access Key. The key reads public data only and needs no permissions. A new application starts in demo mode, which allows 50 requests an hour, plenty for this.",
    url: "https://unsplash.com/oauth/applications",
  },
  fields: [
    {
      key: "key",
      label: "Access Key",
      kind: "secret",
    },
    {
      key: "username",
      label: "Username",
      kind: "text",
      placeholder: "yourname",
      help: "The photographer's username, as in unsplash.com/@yourname.",
      pattern: {
        source: "@?[A-Za-z0-9_]{1,40}",
        message: "A username has letters, numbers and underscores only",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.unsplash.com"] },
  egress: {
    to: "Unsplash (api.unsplash.com)",
    sends:
      "Your Access Key, with requests for your public profile and your download and view statistics",
    why: "To show your photo downloads and views as numbers. Nothing is written back.",
  },
};
