import { HACKER_NEWS } from "@/lib/connectors/hackernews/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const hackernews: ModuleManifest = {
  id: "hackernews",
  name: "Hacker News mentions",
  summary:
    "New Hacker News stories and comments that mention your product, your name or your domain, as tasks to read and maybe answer.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: [
    "Founders",
    "Developer advocates",
    "Open-source maintainers",
    "Marketers",
  ],
  sources: ["HACKERNEWS"],
  linkLabels: { HACKERNEWS: "Open on Hacker News" },
  claimLabels: { HACKERNEWS: "All Hacker News mentions" },
  adds: [
    "A task for each new story or comment that names what you watch",
    "Mentions older than the days you keep them close on their own",
    "Each watched word a goal can claim",
  ],
  keeps:
    "The words you watch, and for each mention its title, author, text and link.",
  egress: [HACKER_NEWS.egress],
  connect: {
    service: HACKER_NEWS,
    makes: ["tasks"],
    everyMinutes: 30,
    settings: [
      {
        kind: "list",
        key: "words",
        label: "Watch for",
        help: "One per line: a product, a name, a domain. Only exact mentions count.",
        placeholder: "sigwald",
        maxItems: 10,
      },
      {
        kind: "select",
        key: "kinds",
        label: "Mentions in",
        options: [
          { value: "story,comment", label: "Stories and comments" },
          { value: "story", label: "Stories only" },
          { value: "comment", label: "Comments only" },
        ],
        default: "story,comment",
      },
      {
        kind: "number",
        key: "days",
        label: "Keep each for",
        min: 1,
        max: 14,
        default: 3,
        unit: "days",
      },
      maxOpenField(15),
    ],
  },
};

export default hackernews;
