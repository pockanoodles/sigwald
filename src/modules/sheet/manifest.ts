import { WEB } from "@/lib/connectors/web/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const column = (label: string, help?: string) => ({
  kind: "text" as const,
  label,
  help,
  optional: true,
  maxLength: 80,
});

const sheet: ModuleManifest = {
  id: "sheet",
  name: "Spreadsheet",
  summary:
    "Any published spreadsheet's rows as tasks: a Google Sheet published as CSV, a shared Airtable view, any .csv link. Tick a row done there and it's done here.",
  defaultOn: false,
  beta: true,
  shelf: "anything",
  madeFor: [
    "Ops teams",
    "Producers",
    "Teachers",
    "Anyone who runs work from a sheet",
  ],
  sources: ["SHEET"],
  linkLabels: { SHEET: "Open the row's link" },
  claimLabels: { SHEET: "All spreadsheet rows" },
  adds: [
    "A task for each row, titled and dated by the columns you name",
    "Finished when its done column says so (TRUE, yes, x, done)",
    "Rows gone from the sheet close their tasks",
  ],
  keeps:
    "The link you give it, and for each row the cells it reads: title, due, done, link, note.",
  egress: [WEB.egress],
  connect: {
    service: WEB,
    makes: ["tasks"],
    everyMinutes: 30,
    settings: [
      {
        kind: "text",
        key: "link",
        label: "CSV link",
        help: "In Google Sheets: File, Share, Publish to web, pick the sheet and Comma-separated values.",
        placeholder:
          "https://docs.google.com/spreadsheets/d/e/…/pub?output=csv",
        maxLength: 2000,
        pattern: { source: "https?://\\S+", message: "use a web link" },
      },
      {
        kind: "text",
        key: "title",
        label: "Title column",
        help: "The header of the column that names each task.",
        placeholder: "Task",
        maxLength: 80,
      },
      { key: "due", ...column("Due column") },
      {
        key: "done",
        ...column("Done column", "TRUE, yes, x, done or ✓ finish the task."),
      },
      { key: "url", ...column("Link column") },
      { key: "note", ...column("Note column") },
      {
        key: "id",
        ...column(
          "ID column",
          "Keeps a task matched to its row when rows move or are renamed."
        ),
      },
      {
        kind: "select",
        key: "dates",
        label: "Dates are written",
        options: [
          { value: "ymd", label: "2026-11-20" },
          { value: "mdy", label: "11/20/2026" },
          { value: "dmy", label: "20/11/2026" },
        ],
        default: "ymd",
      },
      maxOpenField(50),
    ],
  },
};

export default sheet;
