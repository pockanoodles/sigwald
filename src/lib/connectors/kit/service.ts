import type { ServiceManifest } from "@/lib/connectors/types";

export const KIT: ServiceManifest = {
  id: "kit",
  name: "Kit",
  homepage: "https://kit.com",
  tokenHelp: {
    text: "Make a v4 API key in Kit under Account settings, Developer. A Kit API key can read your broadcasts and subscribers, and Sigwald only ever reads.",
    url: "https://app.kit.com/account_settings/developer_settings",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
      help: "A v4 key, not the older v3 API secret.",
    },
  ],
  host: { kind: "fixed", hosts: ["api.kit.com"] },
  egress: {
    to: "Kit (api.kit.com)",
    sends:
      "Your API key, with requests for your draft, scheduled and sent broadcasts and your active subscriber count",
    why: "To make a task for each draft broadcast, a calendar event for each scheduled send, finish a draft's task once it is sent, and show your active subscribers. Nothing is written back.",
  },
};
