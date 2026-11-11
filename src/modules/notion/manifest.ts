import { NOTION } from "@/lib/connectors/notion/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const notion: ModuleManifest = {
  id: "notion",
  name: "Notion",
  summary:
    "The rows of any Notion databases you pick, as tasks with their date as the due date, finished when their status says done.",
  defaultOn: false,
  beta: true,
  shelf: "projects",
  madeFor: ["Notion users", "Students", "Small teams"],
  sources: ["NOTION"],
  linkLabels: { NOTION: "Open in Notion" },
  claimLabels: { NOTION: "All Notion work" },
  adds: [
    "A task for each row that isn't done in the databases you name",
    "Due by the row's date, and finished when its status or checkbox says done",
    "Databases a goal can claim, so finishing a database's rows counts toward it",
  ],
  keeps:
    "For each row: its title, link, date and done mark, with the database's name. Never the rest of the page.",
  egress: [NOTION.egress],
  connect: {
    service: NOTION,
    makes: ["tasks"],
    everyMinutes: 30,
    settings: [
      {
        kind: "list",
        key: "databases",
        label: "Databases",
        help: "One per line: a database's address or its 32-character id. Share each with your integration first.",
        placeholder: "https://www.notion.so/…",
        itemPattern: {
          source:
            ".*[0-9a-fA-F]{32}.*|.*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}.*",
          message: "needs a Notion database address or id",
        },
        maxItems: 10,
      },
      {
        kind: "list",
        key: "done",
        label: "Values that mean done",
        help: "A status or select value in this list marks a row done. A ticked checkbox always does.",
        default: ["Done", "Complete", "Completed"],
        optional: true,
      },
      {
        kind: "text",
        key: "dateProperty",
        label: "Date property",
        help: "The name of the date to use as the due date. Empty uses each database's first date.",
        placeholder: "Due",
        optional: true,
      },
      {
        kind: "text",
        key: "statusProperty",
        label: "Status property",
        help: "The name of the status, select or checkbox that says done. Empty uses each database's first status, then its first checkbox.",
        placeholder: "Status",
        optional: true,
      },
      maxOpenField(30),
    ],
  },
};

export default notion;
