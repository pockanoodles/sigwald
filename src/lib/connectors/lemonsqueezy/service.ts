import type { ServiceManifest } from "@/lib/connectors/types";

export const LEMONSQUEEZY: ServiceManifest = {
  id: "lemonsqueezy",
  name: "Lemon Squeezy",
  homepage: "https://www.lemonsqueezy.com",
  tokenHelp: {
    text: "Make an API key under Settings, then API, in Lemon Squeezy. Its keys have no scopes and no read-only kind, so a key reaches your whole account, but Sigwald only ever reads. A key lasts a year.",
    url: "https://app.lemonsqueezy.com/settings/api",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.lemonsqueezy.com"] },
  egress: {
    to: "Lemon Squeezy (api.lemonsqueezy.com)",
    sends:
      "Your API key, with requests for who you are and your stores' sales and revenue totals",
    why: "To show your revenue and sales as numbers. Nothing is written back.",
  },
};
