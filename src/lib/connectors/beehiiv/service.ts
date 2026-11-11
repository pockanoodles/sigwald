import type { ServiceManifest } from "@/lib/connectors/types";

export const BEEHIIV: ServiceManifest = {
  id: "beehiiv",
  name: "beehiiv",
  homepage: "https://www.beehiiv.com",
  tokenHelp: {
    text: "Make an API key in beehiiv under Settings, Integrations, API. If your plan lets you choose what a key can do, allow reading publications and posts only. Find the publication ID on the same page.",
    url: "https://app.beehiiv.com/settings/integrations",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
    },
    {
      key: "publicationId",
      label: "Publication ID",
      kind: "text",
      placeholder: "pub_…",
      pattern: {
        source: "pub_[A-Za-z0-9-]{8,}",
        message: "A publication ID starts with pub_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.beehiiv.com"] },
  egress: {
    to: "beehiiv (api.beehiiv.com)",
    sends:
      "Your API key and publication ID, with requests for your draft and scheduled posts and your subscriber count",
    why: "To make a task for each draft, a calendar event for each scheduled send, finish a draft's task once it is scheduled or sent, and show your active subscribers. Nothing is written back.",
  },
};
