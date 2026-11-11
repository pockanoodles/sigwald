import type { ModuleManifest } from "@/modules/types";

const courses: ModuleManifest = {
  id: "courses",
  name: "School",
  summary:
    "Your Canvas courses: assignments ranked by what they're worth, with grades, files and announcements.",
  defaultOn: false,
  shelf: "learning",
  madeFor: ["Students on Canvas"],
  page: {
    href: "/courses",
    keywords: [
      "canvas",
      "courses",
      "school",
      "materials",
      "library",
      "syllabus",
      "slides",
      "grades",
    ],
  },
  sources: ["CANVAS"],
  linkLabels: { CANVAS: "Open in Canvas" },
  claimLabels: { CANVAS: "All Canvas work" },
  adds: [
    "Canvas assignments in Today, Focus and Tasks, ranked by their share of your grade",
    "The School page, with files, grades, news and activity",
    "A count of new Canvas activity in the top bar",
    "Canvas grades as proof that a goal's boss fell",
  ],
  keeps:
    "Your courses, assignments, grades, files, announcements and Canvas inbox, copied from Canvas.",
  egress: [
    {
      to: "Your school's Canvas",
      sends: "Your Canvas access token, with each request",
      why: "To read your courses, assignments, grades, files and messages. Nothing is written back.",
    },
  ],
};

export default courses;
