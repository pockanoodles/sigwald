import type { ServiceManifest } from "@/lib/connectors/types";

export const JIRA: ServiceManifest = {
  id: "jira",
  name: "Jira",
  homepage: "https://www.atlassian.com/software/jira",
  tokenHelp: {
    text: "Make an API token in your Atlassian account and paste it with the email you sign in with. The token has your own access, so Sigwald can read only what you can read, and it only ever searches your assigned issues.",
    url: "https://id.atlassian.com/manage-profile/security/api-tokens",
  },
  fields: [
    {
      key: "site",
      label: "Jira address",
      kind: "url",
      placeholder: "https://yourteam.atlassian.net",
    },
    {
      key: "email",
      label: "Email",
      kind: "text",
      placeholder: "you@example.com",
      help: "The email you sign in to Atlassian with.",
    },
    {
      key: "token",
      label: "API token",
      kind: "secret",
    },
  ],
  host: { kind: "site", field: "site", hosts: ["*.atlassian.net"] },
  egress: {
    to: "Your Jira site",
    sends:
      "Your email and API token, with a search for the issues assigned to you",
    why: "To read your open issues with their priority and due dates, and see when they're done. Nothing is written back.",
  },
};
