import type { ModuleManifest } from "@/modules/types";

const ladder: ModuleManifest = {
  id: "ladder",
  name: "Stats",
  summary:
    "Goals for each two-month block, and the XP your finished work earns toward them.",
  // Off for a new install since 1.0: as the first thing a stranger sees, a
  // character sheet of hexes and levels reads as strange before it reads as
  // useful. Everyone with an account before then keeps it on (migration
  // 20261029150000_stats_off_by_default).
  defaultOn: false,
  shelf: "goals",
  madeFor: ["Anyone with goals", "Planners"],
  page: {
    href: "/goals",
    keywords: [
      "goals",
      "bosses",
      "hex",
      "ladder",
      "stats",
      "xp",
      "level",
      "build",
    ],
  },
  sources: [],
  adds: [
    "Tasks that serve an important goal rank higher in Today and Focus",
    "A goal on each task, picked by hand or claimed by a rule",
    "The Stats page, with goals, XP, levels and bosses",
  ],
  keeps:
    "Your goals, two-month blocks and Build. XP is worked out from finished tasks and never stored.",
  egress: [],
};

export default ladder;
