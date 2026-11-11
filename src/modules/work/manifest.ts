import type { ModuleManifest } from "@/modules/types";

const work: ModuleManifest = {
  id: "work",
  name: "Work",
  summary:
    "The jobs you work shifts at: every shift on the calendar, the hours and pay they add up to, and a reminder to hand in your timesheet.",
  defaultOn: false,
  shelf: "money",
  madeFor: ["Shift workers", "Hourly jobs", "Student workers"],
  page: {
    href: "/work",
    keywords: [
      "work",
      "job",
      "shifts",
      "schedule",
      "hours",
      "timesheet",
      "pay",
    ],
  },
  sources: ["WORK"],
  adds: [
    "Your shifts on the calendar, so nothing gets planned on top of them",
    'A "Submit hours" task each pay period, with the shifts and hours to enter',
    "The Work page: each job's shifts, hours against your weekly cap, pay so far and the people to call",
    "The next shift in the top bar on every page",
  ],
  keeps:
    "Your jobs, every shift (imported from a schedule or added by hand) and how it went, and the contacts you keep for each job. Contacts stay in Sigwald.",
  egress: [],
};

export default work;
