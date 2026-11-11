import type { ServiceManifest } from "@/lib/connectors/types";

export const CALENDLY: ServiceManifest = {
  id: "calendly",
  name: "Calendly",
  homepage: "https://calendly.com",
  tokenHelp: {
    text: "Make a personal access token in Calendly under Integrations, API & Webhooks. If it asks for scopes, give it users:read and scheduled_events:read and nothing else.",
    url: "https://calendly.com/integrations/api_webhooks",
  },
  fields: [
    {
      key: "token",
      label: "Personal access token",
      kind: "secret",
      placeholder: "eyJ…",
      pattern: {
        source: "[A-Za-z0-9._-]{20,}",
        message: "A Calendly token is one long string with no spaces",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.calendly.com"] },
  egress: {
    to: "Calendly (api.calendly.com)",
    sends:
      "Your access token, with requests for your booked meetings and the names of who booked them",
    why: "To put the meetings people booked with you on your calendar as busy time, and take them off when they cancel. Nothing is written back.",
  },
};
