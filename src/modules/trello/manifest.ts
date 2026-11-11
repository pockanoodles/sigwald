import { TRELLO } from "@/lib/connectors/trello/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const trello: ModuleManifest = {
  id: "trello",
  name: "Trello",
  summary:
    "The Trello cards you are on, due by their due date and finished when you mark them complete.",
  defaultOn: false,
  beta: true,
  shelf: "projects",
  madeFor: ["Teams on Trello", "Freelancers", "Students"],
  sources: ["TRELLO"],
  linkLabels: { TRELLO: "Open in Trello" },
  claimLabels: { TRELLO: "All Trello work" },
  adds: [
    "A task for each open card you are a member of",
    "Due at the card's due time, and finished when you mark its due date complete",
    "Boards a goal can claim, so finishing a board's cards counts toward it",
  ],
  keeps:
    "For each card you are on: its name, description, link, due date, labels and board.",
  egress: [TRELLO.egress],
  connect: {
    service: TRELLO,
    makes: ["tasks"],
    everyMinutes: 15,
    settings: [maxOpenField(30)],
  },
};

export default trello;
