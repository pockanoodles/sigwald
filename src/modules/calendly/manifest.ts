import { CALENDLY } from "@/lib/connectors/calendly/service";

import type { ModuleManifest } from "@/modules/types";

const calendly: ModuleManifest = {
  id: "calendly",
  name: "Calendly bookings",
  summary:
    "The meetings people book with you on Calendly, on your calendar as busy time, gone when they cancel.",
  defaultOn: false,
  beta: true,
  shelf: "clients",
  madeFor: ["Consultants", "Coaches", "Freelancers", "Founders"],
  sources: [],
  adds: [
    "Each booked meeting as a busy calendar event, titled with its event type",
    "Who booked it, by name, in the event's notes",
    "A cancelled booking comes off the calendar",
  ],
  keeps:
    "For each meeting from yesterday to 30 days ahead: its event type, start and end, location or join link, and the names of who booked it. Never their email addresses.",
  egress: [CALENDLY.egress],
  connect: {
    service: CALENDLY,
    makes: ["events"],
    everyMinutes: 30,
    settings: [
      {
        kind: "toggle",
        key: "names",
        label: "Show who booked",
        help: "Reads each coming meeting's invitees for their names. Turn off to skip those requests.",
        default: true,
      },
    ],
  },
};

export default calendly;
