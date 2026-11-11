import type { ModuleManifest } from "@/modules/types";

const daylight: ModuleManifest = {
  id: "daylight",
  name: "Golden hour",
  summary:
    "Golden and blue hour where you shoot, on your calendar every day, worked out on this machine.",
  defaultOn: false,
  beta: true,
  shelf: "calendar",
  madeFor: ["Photographers", "Filmmakers", "Runners", "Outdoor crews"],
  sources: [],
  adds: [
    "Golden hour and, if you want it, blue hour as calendar events for the days ahead",
    "Free time, not busy: the scheduler still plans around your real commitments",
    "Its own calendar, so you can hide it or recolour it like any other",
  ],
  keeps:
    "The place you set and the coming days' light, as calendar events. Past days drop off.",
  egress: [],
  connect: {
    service: null,
    makes: ["events"],
    everyMinutes: 360,
    forgetPastEvents: true,
    settings: [
      {
        kind: "text",
        key: "place",
        label: "Where",
        help: 'Latitude and longitude, as maps give them: "40.7128, -74.0060".',
        placeholder: "40.7128, -74.0060",
        pattern: {
          source: "-?\\d{1,2}(\\.\\d+)?\\s*,\\s*-?\\d{1,3}(\\.\\d+)?",
          message: "write it as latitude, longitude",
        },
      },
      {
        kind: "text",
        key: "label",
        label: "Its name",
        help: "Shown as each event's place.",
        placeholder: "Brooklyn",
        optional: true,
      },
      { kind: "toggle", key: "morning", label: "Morning light", default: true },
      { kind: "toggle", key: "evening", label: "Evening light", default: true },
      { kind: "toggle", key: "blue", label: "Blue hour too", default: false },
      {
        kind: "number",
        key: "days",
        label: "Days ahead",
        min: 1,
        max: 14,
        default: 7,
        unit: "days",
      },
    ],
  },
};

export default daylight;
