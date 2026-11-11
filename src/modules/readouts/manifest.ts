import type { ModuleManifest } from "@/modules/types";

const readouts: ModuleManifest = {
  id: "readouts",
  name: "Readouts",
  summary:
    "Every number your modules read, on one sheet: revenue, subscribers, hours, citations, and how each moved in a day, a week and a month.",
  defaultOn: false,
  beta: true,
  shelf: "goals",
  madeFor: ["Founders", "Creators", "Freelancers", "Anyone tracking numbers"],
  page: {
    href: "/readouts",
    keywords: ["readouts", "numbers", "metrics", "dashboard", "kpi", "stats"],
  },
  sources: [],
  adds: [
    "The Readouts page: each number, where it stands, and its change over 1, 7 and 30 days",
    "Its history, a day per row, in the reading pane",
    "Nothing of its own to set up: it shows what Stripe, YouTube, beehiiv and the rest read",
  ],
  keeps:
    "Nothing of its own: the numbers belong to the modules that read them, one per day.",
  egress: [],
};

export default readouts;
