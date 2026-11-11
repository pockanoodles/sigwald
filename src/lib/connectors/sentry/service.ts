import type { ServiceManifest } from "@/lib/connectors/types";

export const SENTRY: ServiceManifest = {
  id: "sentry",
  name: "Sentry",
  homepage: "https://sentry.io",
  tokenHelp: {
    text: "Make a personal auth token with the org:read and event:read scopes only. It must be a personal token, not an organization token, because Sentry needs to know who you are to find the issues assigned to you.",
    url: "https://sentry.io/settings/account/api/auth-tokens/",
  },
  fields: [
    {
      key: "token",
      label: "Auth token",
      kind: "secret",
      placeholder: "sntryu_…",
    },
    {
      key: "org",
      label: "Organization slug",
      kind: "text",
      placeholder: "my-company",
      help: "The part after sentry.io/organizations/ in your address.",
      pattern: {
        source: "[A-Za-z0-9][A-Za-z0-9_-]*",
        message: "Use the organization's slug: letters, numbers and dashes",
      },
    },
    {
      key: "region",
      label: "Sentry address",
      kind: "text",
      placeholder: "sentry.io",
      help: "Leave empty for sentry.io. Use us.sentry.io or de.sentry.io if your data is stored there.",
      optional: true,
      pattern: {
        source: "(sentry\\.io|us\\.sentry\\.io|de\\.sentry\\.io)",
        message: "Use sentry.io, us.sentry.io or de.sentry.io",
      },
    },
  ],
  host: {
    kind: "fixed",
    hosts: ["sentry.io", "us.sentry.io", "de.sentry.io"],
  },
  egress: {
    to: "Sentry (sentry.io, us.sentry.io, de.sentry.io)",
    sends:
      "Your auth token, with a search for the unresolved issues assigned to you",
    why: "To read the errors assigned to you and see when they're resolved. Nothing is written back.",
  },
};
