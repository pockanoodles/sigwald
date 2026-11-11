import type { ServiceManifest } from "@/lib/connectors/types";

export const TRANSISTOR: ServiceManifest = {
  id: "transistor",
  name: "Transistor",
  homepage: "https://transistor.fm",
  tokenHelp: {
    text: "Copy your API key from your account page in the Transistor dashboard. Transistor keys are tied to your account and can't be limited, and Sigwald only reads with it.",
    url: "https://dashboard.transistor.fm/account",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.transistor.fm"] },
  egress: {
    to: "Transistor (api.transistor.fm)",
    sends:
      "Your API key, with requests for your shows, your draft and scheduled episodes and each show's download counts",
    why: "To turn unfinished episodes into tasks, put scheduled releases on your calendar and read your downloads as a number. Nothing is written back.",
  },
};
