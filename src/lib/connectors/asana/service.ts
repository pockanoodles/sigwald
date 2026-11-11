import type { ServiceManifest } from "@/lib/connectors/types";

export const ASANA: ServiceManifest = {
  id: "asana",
  name: "Asana",
  homepage: "https://asana.com",
  tokenHelp: {
    text: "Make a personal access token in the Asana developer console. It has your own access, so Sigwald can read only what you can read, and it only ever lists your assigned tasks.",
    url: "https://app.asana.com/0/my-apps",
  },
  fields: [
    {
      key: "token",
      label: "Personal access token",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["app.asana.com"] },
  egress: {
    to: "Asana (app.asana.com)",
    sends: "Your access token, with a request for the tasks assigned to you",
    why: "To read your assigned tasks with their due dates and projects, and see when they're completed. Nothing is written back.",
  },
};
