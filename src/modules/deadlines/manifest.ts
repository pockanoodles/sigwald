import { WEB } from "@/lib/connectors/web/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const deadlines: ModuleManifest = {
  id: "deadlines",
  name: "Deadline feed",
  summary:
    "Turns a calendar link of due dates into tasks: Blackboard, Brightspace, Moodle and Gradescope export one, and so do grant, filing and league calendars.",
  defaultOn: false,
  beta: true,
  shelf: "calendar",
  madeFor: [
    "Students",
    "Teachers",
    "Grant writers",
    "Anyone handed an .ics of deadlines",
  ],
  sources: ["DEADLINES"],
  linkLabels: { DEADLINES: "Open the calendar it came from" },
  claimLabels: { DEADLINES: "All feed deadlines" },
  adds: [
    "A task for each event in the link's coming weeks, due when the event starts (or ends)",
    "Past deadlines stay open for two weeks, so a missed one isn't hidden",
    "Each link a goal can claim on its own",
  ],
  keeps:
    "Each link you give it, and for each deadline its title, time and notes.",
  egress: [WEB.egress],
  connect: {
    service: WEB,
    makes: ["tasks"],
    everyMinutes: 60,
    taskCategory: "PERSONAL",
    settings: [
      {
        kind: "list",
        key: "links",
        label: "Calendar links",
        help: "One per line: https:// or webcal:// links to .ics files.",
        placeholder: "webcal://school.example.edu/calendar/me.ics",
        maxItems: 10,
        itemPattern: {
          source: "(https?|webcals?)://\\S+",
          message: "use a web or webcal link",
        },
      },
      {
        kind: "text",
        key: "only",
        label: "Only events whose title has",
        help: 'A word, like "due" or "deadline". Empty takes every event.',
        optional: true,
        maxLength: 60,
      },
      {
        kind: "select",
        key: "dueAt",
        label: "Due when the event",
        options: [
          { value: "start", label: "starts" },
          { value: "end", label: "ends" },
        ],
        default: "start",
      },
      {
        kind: "number",
        key: "ahead",
        label: "Look ahead",
        min: 7,
        max: 365,
        default: 60,
        unit: "days",
      },
      maxOpenField(40),
    ],
  },
};

export default deadlines;
