import { AIRTABLE } from "@/lib/connectors/airtable/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const airtable: ModuleManifest = {
  id: "airtable",
  name: "Airtable",
  summary:
    "The records of one Airtable table as tasks, titled by a field you pick, due by a date field and finished by a checkbox.",
  defaultOn: false,
  beta: true,
  shelf: "projects",
  madeFor: ["Airtable users", "Small teams", "Operations"],
  sources: ["AIRTABLE"],
  linkLabels: { AIRTABLE: "Open in Airtable" },
  claimLabels: { AIRTABLE: "All Airtable work" },
  adds: [
    "A task for each record in the table, or in one view of it",
    "Due by the record's date field, and finished when its checkbox is ticked",
    "The table as a group a goal can claim",
  ],
  keeps:
    "For each record: the title, due date and done mark you chose, and a link. Never its other fields.",
  egress: [AIRTABLE.egress],
  connect: {
    service: AIRTABLE,
    makes: ["tasks"],
    everyMinutes: 30,
    settings: [
      {
        kind: "text",
        key: "base",
        label: "Base id",
        help: "Starts with app. It's in the base's web address.",
        placeholder: "appXXXXXXXXXXXXXX",
        pattern: {
          source: "app[A-Za-z0-9]{8,}",
          message: "A base id starts with app",
        },
      },
      {
        kind: "text",
        key: "table",
        label: "Table",
        help: "Its name or id (starts with tbl).",
        placeholder: "Tasks",
      },
      {
        kind: "text",
        key: "view",
        label: "View",
        help: "Only this view's records. Empty reads the whole table.",
        optional: true,
      },
      {
        kind: "text",
        key: "titleField",
        label: "Title field",
        help: "The name of the field that holds each task's title.",
        placeholder: "Name",
      },
      {
        kind: "text",
        key: "dueField",
        label: "Due field",
        help: "The name of a date field, if records have one.",
        optional: true,
      },
      {
        kind: "text",
        key: "doneField",
        label: "Done field",
        help: "The name of a checkbox field. Ticked means the task is done.",
        optional: true,
      },
      maxOpenField(30),
    ],
  },
};

export default airtable;
