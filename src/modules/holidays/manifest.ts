import { NAGER } from "@/lib/connectors/nager/service";

import type { ModuleManifest } from "@/modules/types";

const holidays: ModuleManifest = {
  id: "holidays",
  name: "Holidays",
  summary:
    "Public holidays for the countries you work with, on your calendar a year ahead, so a team across borders sees who's off.",
  defaultOn: false,
  beta: true,
  shelf: "calendar",
  madeFor: [
    "Distributed teams",
    "Travellers",
    "Payroll and HR",
    "Freelancers with clients abroad",
  ],
  sources: [],
  adds: [
    "Each chosen country's public holidays as all-day events, a year ahead",
    "Free time by default, or busy days if you don't work them",
    "Its own calendar, to hide or recolour like any other",
  ],
  keeps: "The countries you choose and their holidays, as calendar events.",
  egress: [NAGER.egress],
  connect: {
    service: NAGER,
    makes: ["events"],
    everyMinutes: 24 * 60,
    settings: [
      {
        kind: "list",
        key: "countries",
        label: "Countries",
        help: "Two-letter codes, one per line: US, JP, GB, DE, IN.",
        placeholder: "US",
        maxItems: 12,
        itemPattern: {
          source: "[A-Za-z]{2}",
          message: "use a two-letter country code",
        },
      },
      {
        kind: "toggle",
        key: "regional",
        label: "Include regional holidays",
        help: "Holidays only some states or provinces keep.",
        default: false,
      },
      {
        kind: "toggle",
        key: "busy",
        label: "Keep holidays free of scheduled work",
        default: false,
      },
    ],
  },
};

export default holidays;
