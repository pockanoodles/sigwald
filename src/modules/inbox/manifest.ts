import type { ModuleManifest } from "@/modules/types";

const inbox: ModuleManifest = {
  id: "inbox",
  name: "Inbox",
  summary:
    "A private address anything can send work to: Zapier, Make, n8n, a phone shortcut or a script. What arrives becomes tasks and calendar events.",
  defaultOn: false,
  beta: true,
  shelf: "anything",
  madeFor: [
    "Automators",
    "Ops people",
    "Anyone with a tool Sigwald doesn't read",
  ],
  sources: ["INBOX"],
  linkLabels: { INBOX: "Open the link it was sent with" },
  claimLabels: { INBOX: "All work sent to the Inbox" },
  adds: [
    "A task for each thing sent, with its due, link, note, length and priority",
    "A calendar event for anything sent with a start time",
    "Lists a goal can claim, named by whatever sends them",
  ],
  keeps:
    "What's sent to it, and a fingerprint of its private address (never the address itself).",
  egress: [],
  connect: {
    service: null,
    receives: true,
    makes: ["tasks", "events"],
    everyMinutes: 0,
    // What's sent is asked for by name, so none of it waits for room; the
    // address takes no more once 500 things sent to it are still open.
    settings: [],
  },
};

export default inbox;
