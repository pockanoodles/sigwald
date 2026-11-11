import type { ServiceManifest } from "@/lib/connectors/types";

export const TRELLO: ServiceManifest = {
  id: "trello",
  name: "Trello",
  homepage: "https://trello.com",
  tokenHelp: {
    text: "Make an API key by adding a Power-Up in the Trello admin page, then open the authorize link with your key and scope=read to get a token. Read is the only scope Sigwald needs.",
    url: "https://trello.com/power-ups/admin",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
      pattern: {
        source: "[A-Fa-f0-9]{32}",
        message: "A Trello API key is 32 letters and numbers",
      },
    },
    {
      key: "token",
      label: "Token",
      kind: "secret",
      placeholder: "ATTA…",
      pattern: {
        source: "[A-Za-z0-9_-]{20,}",
        message: "Paste the token Trello showed you",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.trello.com"] },
  egress: {
    to: "Trello (api.trello.com)",
    sends:
      "Your API key and token, with requests for your open cards and your boards' names",
    why: "To read the cards you are on with their due dates, and see when they're marked complete. Nothing is written back.",
  },
};
