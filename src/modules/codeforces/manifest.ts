import { CODEFORCES } from "@/lib/connectors/codeforces/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const codeforces: ModuleManifest = {
  id: "codeforces",
  name: "Codeforces",
  summary:
    "The next month's Codeforces rounds on your calendar, and your rating as a number, for competitive programmers keeping a training plan.",
  defaultOn: false,
  beta: true,
  shelf: "learning",
  madeFor: [
    "Competitive programmers",
    "Students prepping for interviews",
    "ICPC teams",
  ],
  sources: [],
  adds: [
    "Each round in the next 30 days as a calendar event, with its length",
    "Your rating and best rating in Readouts, if you set your handle",
    "Rounds left free for the scheduler, or blocked if you mean to compete",
  ],
  keeps: "Your handle, the coming rounds and your rating each day.",
  egress: [CODEFORCES.egress],
  connect: {
    service: CODEFORCES,
    makes: ["events", "readings"],
    everyMinutes: 360,
    headline: "rating",
    settings: [
      {
        kind: "text",
        key: "handle",
        label: "Your handle",
        optional: true,
        placeholder: "tourist",
        pattern: {
          source: "[A-Za-z0-9_.-]{3,24}",
          message: "use your Codeforces handle",
        },
      },
      {
        kind: "toggle",
        key: "rounds",
        label: "Rounds on the calendar",
        default: true,
      },
      {
        kind: "toggle",
        key: "busy",
        label: "Block round time",
        default: false,
      },
      STATUS_FIELD,
    ],
  },
};

export default codeforces;
