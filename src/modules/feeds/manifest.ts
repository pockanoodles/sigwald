import { WEB } from "@/lib/connectors/web/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const feeds: ModuleManifest = {
  id: "feeds",
  name: "Feeds",
  summary:
    "New posts from the RSS and Atom feeds you follow (blogs, release notes, journals, newsletters on the web) as reading tasks, kept for as long as you say.",
  defaultOn: false,
  beta: true,
  shelf: "research",
  madeFor: [
    "Writers",
    "Analysts",
    "Engineers tracking releases",
    "Anyone who reads to work",
  ],
  sources: ["FEEDS"],
  linkLabels: { FEEDS: "Open the post" },
  claimLabels: { FEEDS: "All feed reading" },
  adds: [
    "A task for each new post, with its summary, from every feed you list",
    "Posts older than the days you keep them close on their own",
    "Each feed a goal can claim on its own",
  ],
  keeps:
    "The feeds you list, and for each new post its title, link, author and summary.",
  egress: [WEB.egress],
  connect: {
    service: WEB,
    makes: ["tasks"],
    everyMinutes: 60,
    taskCategory: "PERSONAL",
    settings: [
      {
        kind: "list",
        key: "feeds",
        label: "Feeds",
        help: "One feed address per line (it often ends in /feed, /rss or .xml).",
        placeholder: "https://example.com/feed.xml",
        maxItems: 25,
        itemPattern: { source: "https?://\\S+", message: "use a web address" },
      },
      {
        kind: "text",
        key: "only",
        label: "Only posts whose title has",
        optional: true,
        maxLength: 60,
      },
      {
        kind: "number",
        key: "days",
        label: "Keep each post for",
        min: 1,
        max: 60,
        default: 7,
        unit: "days",
      },
      maxOpenField(20),
    ],
  },
};

export default feeds;
