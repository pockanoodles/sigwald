import { FIGMA } from "@/lib/connectors/figma/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const figma: ModuleManifest = {
  id: "figma",
  name: "Figma",
  summary:
    "Comment threads in the Figma files you list that are waiting on your reply, as tasks that finish when the thread is resolved or you answer.",
  defaultOn: false,
  beta: true,
  shelf: "creative",
  madeFor: ["Designers", "Design reviewers", "Product teams"],
  sources: ["FIGMA"],
  linkLabels: { FIGMA: "Open in Figma" },
  claimLabels: { FIGMA: "All Figma comments" },
  adds: [
    "A task for each open comment thread in your files that someone else wrote last",
    "Finished when the thread is resolved or you reply last, so the goals that claim its file earn for it",
    "Files a goal can claim, so a design review counts toward it",
  ],
  keeps:
    "For each thread it tracks: the file's name, who started it, the first words of the comment and when it was last answered.",
  egress: [FIGMA.egress],
  connect: {
    service: FIGMA,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [
      {
        kind: "list",
        key: "files",
        label: "Files to watch",
        help: "Figma file addresses or keys, one per line.",
        placeholder: "https://www.figma.com/design/abc123…",
        itemPattern: {
          source:
            "(https://([a-z0-9-]+\\.)?figma\\.com/[^\\s]+|[A-Za-z0-9]{10,})",
          message: "a Figma file address or its key",
        },
        maxItems: 20,
      },
      {
        kind: "toggle",
        key: "mentionsOnly",
        label: "Only threads that mention me",
        help: "Off: every open thread someone else wrote last.",
        default: false,
      },
      maxOpenField(30),
    ],
  },
};

export default figma;
