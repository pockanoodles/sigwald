import { SEMANTIC_SCHOLAR } from "@/lib/connectors/semanticscholar/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const scholar: ModuleManifest = {
  id: "scholar",
  name: "Semantic Scholar",
  summary:
    "Your citations, h-index and paper count from Semantic Scholar, read daily, so a research goal has numbers to show.",
  defaultOn: false,
  beta: true,
  shelf: "research",
  madeFor: ["Academics", "PhD students", "Research labs"],
  sources: [],
  adds: [
    "Citations, h-index and papers as numbers in Readouts",
    "A count in the top bar, if you want one",
    "No account: it reads your public author page's numbers",
  ],
  keeps:
    "Your author id, and each day's citation count, h-index and paper count.",
  egress: [SEMANTIC_SCHOLAR.egress],
  connect: {
    service: SEMANTIC_SCHOLAR,
    makes: ["readings"],
    everyMinutes: 24 * 60,
    headline: "citations",
    settings: [
      {
        kind: "text",
        key: "author",
        label: "Author id",
        help: "The number at the end of your author page's address on semanticscholar.org.",
        placeholder: "1741101",
        pattern: {
          source: "\\d{1,12}",
          message: "use the number from your author page",
        },
      },
      STATUS_FIELD,
    ],
  },
};

export default scholar;
