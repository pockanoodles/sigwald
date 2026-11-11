import { ARXIV } from "@/lib/connectors/arxiv/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const arxiv: ModuleManifest = {
  id: "arxiv",
  name: "arXiv",
  summary:
    "The newest papers in your field, by category, words or authors, as reading tasks that step aside after a few days if you don't get to them.",
  defaultOn: false,
  beta: true,
  shelf: "research",
  madeFor: ["Researchers", "PhD students", "ML engineers"],
  sources: ["ARXIV"],
  linkLabels: { ARXIV: "Open on arXiv" },
  claimLabels: { ARXIV: "All arXiv reading" },
  adds: [
    'A "Read" task for each new paper your search finds, with its abstract',
    "Papers older than the days you keep them close on their own",
    "Each paper's primary category a goal can claim",
  ],
  keeps:
    "Your search, and for each paper its title, authors, abstract, categories and link.",
  egress: [ARXIV.egress],
  connect: {
    service: ARXIV,
    makes: ["tasks"],
    everyMinutes: 360,
    settings: [
      {
        kind: "text",
        key: "query",
        label: "Search",
        help: 'arXiv\'s own syntax: cat:cs.LG AND abs:"diffusion", or au:hinton.',
        placeholder: 'cat:cs.LG AND abs:"retrieval"',
        maxLength: 300,
      },
      {
        kind: "number",
        key: "days",
        label: "Keep each paper for",
        min: 1,
        max: 30,
        default: 4,
        unit: "days",
      },
      maxOpenField(15),
    ],
  },
};

export default arxiv;
