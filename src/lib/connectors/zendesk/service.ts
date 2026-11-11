import type { ServiceManifest } from "@/lib/connectors/types";

export const ZENDESK: ServiceManifest = {
  id: "zendesk",
  name: "Zendesk",
  homepage: "https://www.zendesk.com",
  tokenHelp: {
    text: "In Zendesk's Admin Center, open Apps and integrations, then APIs, then Zendesk API, turn on token access and add an API token. Zendesk tokens can't be limited to reading, so Sigwald only ever reads: a search and a lookup of tickets by id.",
    url: "https://support.zendesk.com/hc/en-us/articles/4408889192858-Managing-access-to-the-Zendesk-API",
  },
  fields: [
    {
      key: "site",
      label: "Your Zendesk address",
      kind: "url",
      placeholder: "https://yourcompany.zendesk.com",
      help: "The address you sign in at.",
    },
    {
      key: "email",
      label: "Your Zendesk email",
      kind: "text",
      placeholder: "you@company.com",
      help: "The email you sign in with, which the token goes with.",
      pattern: {
        source: "[^@\\s]+@[^@\\s]+\\.[^@\\s]+",
        message: "An email address",
      },
    },
    {
      key: "token",
      label: "API token",
      kind: "secret",
      pattern: {
        source: "[A-Za-z0-9]{20,}",
        message: "A Zendesk API token is letters and numbers only",
      },
    },
  ],
  host: { kind: "site", field: "site", hosts: ["*.zendesk.com"] },
  egress: {
    to: "Your Zendesk site",
    sends:
      "Your email and API token, with a search for the tickets assigned to you and lookups of tickets by id",
    why: "To read your open tickets with their priority and due dates, and see when they're solved. Nothing is written back.",
  },
};
