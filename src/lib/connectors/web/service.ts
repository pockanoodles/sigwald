import type { ServiceManifest } from "@/lib/connectors/types";

/**
 * Any public address a module's settings name: a calendar link, a published
 * spreadsheet, a feed. No account, so nothing secret travels; every address
 * is checked to be public (never this machine or its network), at every
 * redirect, the same way an iCal subscription is.
 */
export const WEB: ServiceManifest = {
  id: "web",
  name: "Public links",
  homepage: "https://en.wikipedia.org/wiki/URL",
  fields: [],
  host: { kind: "public" },
  egress: {
    to: "The addresses you give it",
    sends:
      "A plain request for each address, which carries your IP address and no account",
    why: "To read the file at each address. Nothing is written back.",
  },
};
