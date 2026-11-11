import type { ServiceManifest } from "@/lib/connectors/types";

/** Semantic Scholar's Academic Graph API, without a key (a shared, rate-limited pool). https://api.semanticscholar.org/api-docs/graph */
export const SEMANTIC_SCHOLAR: ServiceManifest = {
  id: "semanticscholar",
  name: "Semantic Scholar",
  homepage: "https://www.semanticscholar.org",
  fields: [],
  host: { kind: "fixed", hosts: ["api.semanticscholar.org"] },
  egress: {
    to: "Semantic Scholar (api.semanticscholar.org)",
    sends: "The author id you set",
    why: "To read that author's citation count, h-index and number of papers. Nothing is written back.",
  },
};
