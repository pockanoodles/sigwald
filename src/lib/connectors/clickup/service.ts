import type { ServiceManifest } from "@/lib/connectors/types";

export const CLICKUP: ServiceManifest = {
  id: "clickup",
  name: "ClickUp",
  homepage: "https://clickup.com",
  tokenHelp: {
    text: "Copy your personal API token from ClickUp under Settings, Apps. It acts as you and can read whatever you can see, so it can't be narrowed.",
    url: "https://app.clickup.com/settings/apps",
  },
  fields: [
    {
      key: "token",
      label: "Personal API token",
      kind: "secret",
      placeholder: "pk_…",
      pattern: {
        source: "pk_[A-Za-z0-9_]{10,}",
        message: "A ClickUp personal token starts with pk_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.clickup.com"] },
  egress: {
    to: "ClickUp (api.clickup.com)",
    sends:
      "Your personal API token, with requests for your workspace and the tasks assigned to you",
    why: "To read the tasks assigned to you with their priority and due dates, and see when they're done. Nothing is written back.",
  },
};
