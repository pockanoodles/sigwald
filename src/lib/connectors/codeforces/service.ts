import type { ServiceManifest } from "@/lib/connectors/types";

/** Codeforces' public API. No account. https://codeforces.com/apiHelp */
export const CODEFORCES: ServiceManifest = {
  id: "codeforces",
  name: "Codeforces",
  homepage: "https://codeforces.com",
  fields: [],
  host: { kind: "fixed", hosts: ["codeforces.com"] },
  egress: {
    to: "Codeforces (codeforces.com)",
    sends: "The handle you set, if any",
    why: "To read the coming contests and your rating. Nothing is written back.",
  },
};
