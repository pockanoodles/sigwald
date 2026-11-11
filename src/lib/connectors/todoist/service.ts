import type { ServiceManifest } from "@/lib/connectors/types";

export const TODOIST: ServiceManifest = {
  id: "todoist",
  name: "Todoist",
  homepage: "https://todoist.com",
  tokenHelp: {
    text: "Copy your API token from Todoist under Settings, Integrations, Developer. It can read and change your tasks, so it can't be narrowed; Sigwald only reads with it.",
    url: "https://app.todoist.com/app/settings/integrations/developer",
  },
  fields: [
    {
      key: "token",
      label: "API token",
      kind: "secret",
      pattern: {
        source: "[A-Za-z0-9]{30,}",
        message: "A Todoist API token is a long run of letters and numbers",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.todoist.com"] },
  egress: {
    to: "Todoist (api.todoist.com)",
    sends:
      "Your API token, with requests for your active tasks, your projects' names and the tasks you completed lately",
    why: "To read your tasks with their priority and due dates, and see when they're done. Nothing is written back.",
  },
};
