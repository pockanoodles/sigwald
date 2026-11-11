import type { ServiceManifest } from "@/lib/connectors/types";

export const READWISE: ServiceManifest = {
  id: "readwise",
  name: "Readwise Reader",
  homepage: "https://readwise.io/read",
  tokenHelp: {
    text: "Copy your access token from the Readwise page below. Readwise tokens can't be limited, and Sigwald only reads with it.",
    url: "https://readwise.io/access_token",
  },
  fields: [
    {
      key: "token",
      label: "Access token",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["readwise.io"] },
  egress: {
    to: "Readwise Reader (readwise.io)",
    sends:
      "Your access token, with requests for the documents in your Later and Shortlist and the ones you archived lately",
    why: "To turn the articles you saved to read into tasks, and see when you archive them. Nothing is written back.",
  },
};
