import type { ServiceManifest } from "@/lib/connectors/types";

export const FIGMA: ServiceManifest = {
  id: "figma",
  name: "Figma",
  homepage: "https://www.figma.com",
  tokenHelp: {
    text: "Make a personal access token in Figma under Settings, Security. Give it read-only scopes: Users (current_user:read), File metadata (file_metadata:read) and Comments (file_comments:read). Nothing that writes.",
    url: "https://www.figma.com/settings",
  },
  fields: [
    {
      key: "token",
      label: "Personal access token",
      kind: "secret",
      placeholder: "figd_…",
    },
  ],
  host: { kind: "fixed", hosts: ["api.figma.com"] },
  egress: {
    to: "Figma (api.figma.com)",
    sends:
      "Your personal access token, with requests for who you are and for the name and comments of each file you list",
    why: "To make a task for each comment thread that is waiting on your reply, and finish it when the thread is resolved or you answer. Nothing is written back.",
  },
};
