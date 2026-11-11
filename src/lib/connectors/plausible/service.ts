import type { ServiceManifest } from "@/lib/connectors/types";

export const PLAUSIBLE: ServiceManifest = {
  id: "plausible",
  name: "Plausible",
  homepage: "https://plausible.io",
  tokenHelp: {
    text: "In Plausible open your account settings, then API Keys, choose New API Key and pick Stats API. The key only reads your stats. Copy it when it shows, because Plausible shows it once.",
    url: "https://plausible.io/settings#api-keys",
  },
  fields: [
    {
      key: "site",
      label: "Plausible address",
      kind: "url",
      placeholder: "https://plausible.io",
      help: "plausible.io, or the address of your own Plausible install.",
    },
    {
      key: "token",
      label: "Stats API key",
      kind: "secret",
      placeholder: "Your Stats API key",
    },
    {
      key: "domain",
      label: "Site",
      kind: "text",
      placeholder: "example.com",
      help: "The domain as it is listed in Plausible (its site id).",
      pattern: {
        source: "[A-Za-z0-9._:/-]{1,253}",
        message: "A domain, like example.com",
      },
    },
  ],
  host: { kind: "site", field: "site" },
  readsWithPost:
    "Plausible's Stats API answers each query by POST with a JSON body; Sigwald sends it only queries for counts, and nothing it sends changes anything.",
  egress: {
    to: "Your Plausible site",
    sends:
      "Your Stats API key and your site's domain, with queries for today's and the last 30 days' visitors, pageviews and bounce rate",
    why: "To show your visitors, pageviews and bounce rate as numbers. Nothing is written back.",
  },
};
