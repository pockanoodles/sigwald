import type { ServiceManifest } from "@/lib/connectors/types";

/** Hacker News search, run by Algolia. No account. https://hn.algolia.com/api */
export const HACKER_NEWS: ServiceManifest = {
  id: "hackernews",
  name: "Hacker News",
  homepage: "https://news.ycombinator.com",
  fields: [],
  host: { kind: "fixed", hosts: ["hn.algolia.com"] },
  egress: {
    to: "Hacker News search by Algolia (hn.algolia.com)",
    sends: "The words you watch for (a product, a name, a domain)",
    why: "To find new stories and comments that mention them. Nothing is written back.",
  },
};
