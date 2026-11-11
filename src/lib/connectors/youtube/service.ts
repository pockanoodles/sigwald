import type { ServiceManifest } from "@/lib/connectors/types";

export const YOUTUBE: ServiceManifest = {
  id: "youtube",
  name: "YouTube",
  homepage: "https://www.youtube.com",
  tokenHelp: {
    text: "Make an API key in a Google Cloud project, turn on the YouTube Data API v3 for that project, and restrict the key to that one API. It reads public numbers and needs no sign-in.",
    url: "https://console.cloud.google.com/apis/credentials",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
      placeholder: "AIza…",
    },
    {
      key: "channel",
      label: "Channel",
      kind: "text",
      placeholder: "@handle or UC…",
      help: "The channel's @handle, or its channel id (it starts with UC).",
      pattern: {
        source: "(UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9._-]{3,30})",
        message: "A channel id starts with UC, a handle with @",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["www.googleapis.com"] },
  egress: {
    to: "YouTube Data API (www.googleapis.com)",
    sends:
      "Your API key, with requests for your channel's public counts and the views on its newest video",
    why: "To show your subscribers, views and videos as numbers. Nothing is written back.",
  },
};
