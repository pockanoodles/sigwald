import { ZOTERO } from "@/lib/connectors/zotero/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const zotero: ModuleManifest = {
  id: "zotero",
  name: "Zotero",
  summary:
    "The papers you tagged to read as tasks, finished when you take the tag off in Zotero.",
  defaultOn: false,
  beta: true,
  shelf: "research",
  madeFor: ["Researchers", "Grad students", "Anyone with a reading list"],
  sources: ["ZOTERO"],
  linkLabels: { ZOTERO: "Open the paper" },
  claimLabels: { ZOTERO: "All Zotero reading" },
  adds: [
    "A task, Read, for each top-level item with your reading tag",
    "Authors, year and publication on each task, linked to the paper",
    "Finished when you take the tag off, or the item leaves the collection",
  ],
  keeps:
    "For each item it tracks: its title, authors, year, publication and link. Never the files or your notes.",
  egress: [ZOTERO.egress],
  connect: {
    service: ZOTERO,
    makes: ["tasks"],
    everyMinutes: 30,
    settings: [
      {
        kind: "text",
        key: "tag",
        label: "Reading tag",
        help: "Items with this tag are your queue.",
        default: "to-read",
        pattern: {
          source: "[^,]{1,100}",
          message: "one tag, up to 100 characters",
        },
      },
      {
        kind: "text",
        key: "collection",
        label: "Collection key instead",
        help: "The 8 characters at the end of a collection's address. Empty means use the tag.",
        optional: true,
        pattern: {
          source: "[A-Za-z0-9]{8}",
          message: "8 letters and numbers",
        },
      },
      maxOpenField(30),
    ],
  },
};

export default zotero;
