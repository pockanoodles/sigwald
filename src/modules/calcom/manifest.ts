import { CALCOM } from "@/lib/connectors/calcom/service";

import type { ModuleManifest } from "@/modules/types";

const calcom: ModuleManifest = {
  id: "calcom",
  name: "Cal.com bookings",
  summary:
    "The meetings people book with you on Cal.com, on your calendar as busy time, gone when they cancel.",
  defaultOn: false,
  beta: true,
  shelf: "clients",
  madeFor: ["Consultants", "Coaches", "Freelancers", "Small teams"],
  sources: [],
  adds: [
    "Each upcoming booking as a busy calendar event",
    "Who booked it, by name, in the event's notes",
    "A cancelled booking comes off the calendar",
  ],
  keeps:
    "For each booking from yesterday to 30 days ahead: its title, start and end, location or join link, and the names of who booked it. Never their email addresses.",
  egress: [CALCOM.egress],
  connect: {
    service: CALCOM,
    makes: ["events"],
    everyMinutes: 30,
    settings: [],
  },
};

export default calcom;
