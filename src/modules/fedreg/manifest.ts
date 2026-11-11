import { FEDERAL_REGISTER } from "@/lib/connectors/fedreg/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const fedreg: ModuleManifest = {
  id: "fedreg",
  name: "Federal Register",
  summary:
    "Proposed rules and notices on your topics that are still open for public comment, as tasks due the day comments close.",
  defaultOn: false,
  beta: true,
  shelf: "research",
  madeFor: [
    "Policy analysts",
    "Lawyers",
    "Advocacy groups",
    "Compliance teams",
  ],
  sources: ["FEDREG"],
  linkLabels: { FEDREG: "Open in the Federal Register" },
  claimLabels: { FEDREG: "All comment deadlines" },
  adds: [
    'A "Comment on" task for each matching document, due when its comment period closes',
    "Closed comment periods leave your lists on their own",
    "Each agency a goal can claim",
  ],
  keeps:
    "Your words and agencies, and for each document its title, agencies, type, dates and link.",
  egress: [FEDERAL_REGISTER.egress],
  connect: {
    service: FEDERAL_REGISTER,
    makes: ["tasks"],
    everyMinutes: 360,
    settings: [
      {
        kind: "text",
        key: "terms",
        label: "Words",
        help: "What the documents are about: privacy, broadband, emissions.",
        placeholder: "data privacy",
        maxLength: 200,
      },
      {
        kind: "list",
        key: "agencies",
        label: "Only these agencies",
        help: "Their names in the Federal Register's addresses, one per line: environmental-protection-agency.",
        placeholder: "federal-trade-commission",
        optional: true,
        maxItems: 15,
        itemPattern: {
          source: "[a-z0-9-]+",
          message:
            "use the agency's address name, like federal-trade-commission",
        },
      },
      {
        kind: "select",
        key: "types",
        label: "Documents",
        options: [
          { value: "PRORULE", label: "Proposed rules" },
          { value: "PRORULE,NOTICE", label: "Proposed rules and notices" },
          { value: "PRORULE,NOTICE,RULE", label: "Anything taking comments" },
        ],
        default: "PRORULE",
      },
      maxOpenField(20),
    ],
  },
};

export default fedreg;
