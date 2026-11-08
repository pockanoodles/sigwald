import type { ModuleManifest } from "@/modules/types";

const nutrition: ModuleManifest = {
  id: "nutrition",
  name: "Nutrition",
  summary:
    "What you eat against daily targets for calories, protein, carbs and fat, with the foods you eat often a tap away.",
  defaultOn: false,
  beta: true,
  page: {
    href: "/nutrition",
    keywords: [
      "nutrition",
      "food",
      "macros",
      "calories",
      "protein",
      "diet",
      "meals",
    ],
  },
  sources: [],
  adds: [
    "The Nutrition page: each day's food against your targets",
    "Saved foods, so the usual ones take a tap to log",
    "Protein left today in the top bar, or calories if that's all you track",
  ],
  keeps:
    "Your daily targets, the foods you save, and what you log eating each day.",
  egress: [],
};

export default nutrition;
