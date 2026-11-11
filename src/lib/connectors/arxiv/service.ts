import type { ServiceManifest } from "@/lib/connectors/types";

/** arXiv's public query API (Atom). No account. https://info.arxiv.org/help/api/user-manual.html */
export const ARXIV: ServiceManifest = {
  id: "arxiv",
  name: "arXiv",
  homepage: "https://arxiv.org",
  fields: [],
  host: { kind: "fixed", hosts: ["export.arxiv.org"] },
  egress: {
    to: "arXiv (export.arxiv.org)",
    sends: "The search you set (categories, words, authors)",
    why: "To read the newest papers that match it. Nothing is written back.",
  },
};
