import type { ServiceManifest } from "@/lib/connectors/types";

export const TOGGL: ServiceManifest = {
  id: "toggl",
  name: "Toggl Track",
  homepage: "https://toggl.com/track",
  tokenHelp: {
    text: "Copy your API token from the bottom of your profile page in Toggl Track. It is tied to your user and Toggl has no read-only version, so Sigwald only ever reads.",
    url: "https://track.toggl.com/profile",
  },
  fields: [
    {
      key: "token",
      label: "API token",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.track.toggl.com"] },
  egress: {
    to: "Toggl Track (api.track.toggl.com)",
    sends:
      "Your API token, with requests for who you are and your time entries from the past week",
    why: "To show the hours you tracked today and this week. Nothing is written back.",
  },
};
