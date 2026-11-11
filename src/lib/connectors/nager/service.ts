import type { ServiceManifest } from "@/lib/connectors/types";

/** Nager.Date: public holidays for about a hundred countries. No account. https://date.nager.at/Api */
export const NAGER: ServiceManifest = {
  id: "nager",
  name: "Nager.Date",
  homepage: "https://date.nager.at",
  fields: [],
  host: { kind: "fixed", hosts: ["date.nager.at"] },
  egress: {
    to: "Nager.Date (date.nager.at)",
    sends: "The two-letter codes of the countries you choose, and a year",
    why: "To read those countries' public holidays. Nothing is written back.",
  },
};
