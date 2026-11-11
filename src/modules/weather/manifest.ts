import { OPEN_METEO } from "@/lib/connectors/openmeteo/service";

import { STATUS_FIELD } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const weather: ModuleManifest = {
  id: "weather",
  name: "Weather",
  summary:
    "Today's high, low and chance of rain where you are, and the hours rain is likely on your calendar, for anyone whose work happens outside.",
  defaultOn: false,
  beta: true,
  shelf: "calendar",
  madeFor: [
    "Field crews",
    "Event planners",
    "Photographers",
    "Runners and cyclists",
  ],
  sources: [],
  adds: [
    "The hours rain is likely in the next three days, as free time on the calendar",
    "Today's high, low and chance of rain as numbers, in the top bar if you want",
    "Celsius or Fahrenheit, read every two hours",
  ],
  keeps:
    "The place you set, the day's numbers and the coming rain, as calendar events.",
  egress: [OPEN_METEO.egress],
  connect: {
    service: OPEN_METEO,
    makes: ["events", "readings"],
    everyMinutes: 120,
    forgetPastEvents: true,
    headline: "high",
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
        kind: "select",
        key: "unit",
        label: "Temperatures in",
        options: [
          { value: "celsius", label: "Celsius" },
          { value: "fahrenheit", label: "Fahrenheit" },
        ],
        default: "celsius",
      },
      {
        kind: "number",
        key: "rainAt",
        label: "Rain counts from",
        help: "The chance of rain that puts an hour on the calendar.",
        min: 20,
        max: 100,
        step: 5,
        default: 60,
        unit: "%",
      },
      {
        kind: "toggle",
        key: "rain",
        label: "Rain on the calendar",
        default: true,
      },
      STATUS_FIELD,
    ],
  },
};

export default weather;
