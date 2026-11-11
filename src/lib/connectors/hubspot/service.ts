import type { ServiceManifest } from "@/lib/connectors/types";

export const HUBSPOT: ServiceManifest = {
  id: "hubspot",
  name: "HubSpot",
  homepage: "https://www.hubspot.com",
  tokenHelp: {
    text: "Make a private app in HubSpot and give it read scopes only: crm.objects.owners.read, and crm.objects.contacts.read, which HubSpot also uses for tasks. Copy its access token.",
    url: "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview",
  },
  fields: [
    {
      key: "token",
      label: "Private app token",
      kind: "secret",
      placeholder: "pat-na1-…",
      pattern: {
        source: "pat-[a-z0-9]+-[A-Za-z0-9-]{20,}",
        message: "A HubSpot private app token starts with pat-",
      },
    },
    {
      key: "email",
      label: "Your HubSpot email",
      kind: "text",
      placeholder: "you@company.com",
      help: "Used once, to find which tasks are yours.",
      pattern: {
        source: "[^@\\s]+@[^@\\s]+\\.[^@\\s]+",
        message: "An email address",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.hubapi.com"] },
  readsWithPost:
    "HubSpot's CRM search is a POST that only reads; Sigwald sends it filters for your open tasks and nothing else.",
  egress: {
    to: "HubSpot (api.hubapi.com)",
    sends:
      "Your private app token and your HubSpot email, with searches for the tasks assigned to you",
    why: "To find your owner id, then read your open tasks with their priority and due dates, and see when they're done. Nothing is written back.",
  },
};
