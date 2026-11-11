import { MOODLE } from "@/lib/connectors/moodle/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const moodle: ModuleManifest = {
  id: "moodle",
  name: "Moodle",
  summary:
    "The assignments and quizzes due in your Moodle courses, as tasks due at their deadline, filed under each course.",
  defaultOn: false,
  beta: true,
  shelf: "learning",
  madeFor: ["Students", "Teachers", "Schools on Moodle"],
  sources: ["MOODLE"],
  linkLabels: { MOODLE: "Open in Moodle" },
  claimLabels: { MOODLE: "All Moodle work" },
  adds: [
    "A task for each assignment or quiz due in the next 60 days, due at its deadline",
    "Courses a goal can claim, so finishing a course's work counts toward it",
    "An assignment you have submitted finishes its task",
  ],
  keeps:
    "For each assignment or quiz: its title, link, deadline and course name.",
  egress: [MOODLE.egress],
  connect: {
    service: MOODLE,
    makes: ["tasks"],
    everyMinutes: 30,
    settings: [maxOpenField(30)],
  },
};

export default moodle;
