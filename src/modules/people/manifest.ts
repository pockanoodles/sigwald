import type { ModuleManifest } from "@/modules/types";

const people: ModuleManifest = {
  id: "people",
  name: "People",
  summary:
    "The people you keep in touch with: a cadence for each, and a nudge in Today when one goes quiet.",
  defaultOn: false,
  shelf: "people",
  madeFor: ["Networkers", "Founders", "Job seekers"],
  beta: true,
  page: {
    href: "/people",
    keywords: [
      "people",
      "contacts",
      "crm",
      "network",
      "reach out",
      "networking",
    ],
  },
  sources: ["PEOPLE"],
  linkLabels: { PEOPLE: "Open their profile" },
  claimLabels: { PEOPLE: "All reach-outs (People)" },
  adds: [
    'A "Reach out to" task when someone is due a check-in, ranked like any other work',
    "The People page, with who you know, when you last talked and what about",
    "Reach-outs a goal can claim, so networking counts toward it",
  ],
  keeps:
    "The people you add, how often to check in with each, and the conversations you log.",
  egress: [],
};

export default people;
