import type { ServiceManifest } from "@/lib/connectors/types";

export const GHOST: ServiceManifest = {
  id: "ghost",
  name: "Ghost",
  homepage: "https://ghost.org",
  tokenHelp: {
    text: "In Ghost Admin open Settings, Integrations, and add a custom integration. Paste its Admin API key here. The key can read and write, so Sigwald signs a short-lived token from it and only ever sends reads.",
    url: "https://docs.ghost.org/admin-api",
  },
  fields: [
    {
      key: "site",
      label: "Site address",
      kind: "url",
      placeholder: "https://yourname.ghost.io",
      help: "The address of your Ghost site, the same one you sign in to.",
    },
    {
      key: "adminKey",
      label: "Admin API key",
      kind: "secret",
      placeholder: "24 characters, a colon, then 64 more",
      pattern: {
        source: "[a-fA-F0-9]{24}:[a-fA-F0-9]{64}",
        message: "An Admin API key is an id, a colon and a secret, all hex",
      },
    },
  ],
  host: { kind: "site", field: "site" },
  egress: {
    to: "Your Ghost site",
    sends:
      "A short-lived token signed from your Admin API key on this computer (the key itself never leaves), with requests for your drafts, scheduled posts and member count",
    why: "To make a task for each draft and a calendar event for each scheduled post, finish a draft's task once it is published, and show how many members you have. Nothing is written back.",
  },
};
