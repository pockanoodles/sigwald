import type { ServiceManifest } from "@/lib/connectors/types";

/** The Federal Register's public API. No account. https://www.federalregister.gov/developers/documentation/api/v1 */
export const FEDERAL_REGISTER: ServiceManifest = {
  id: "fedreg",
  name: "Federal Register",
  homepage: "https://www.federalregister.gov",
  fields: [],
  host: { kind: "fixed", hosts: ["www.federalregister.gov"] },
  egress: {
    to: "The Federal Register (www.federalregister.gov)",
    sends: "The words and agencies you follow",
    why: "To read the proposed rules and notices still open for comment. Nothing is written back, and no comment is sent.",
  },
};
