import type { ServiceManifest } from "@/lib/connectors/types";

/** Open-Meteo: weather forecasts, free for non-commercial use, no account. https://open-meteo.com/en/docs */
export const OPEN_METEO: ServiceManifest = {
  id: "openmeteo",
  name: "Open-Meteo",
  homepage: "https://open-meteo.com",
  fields: [],
  host: { kind: "fixed", hosts: ["api.open-meteo.com"] },
  egress: {
    to: "Open-Meteo (api.open-meteo.com)",
    sends: "The place you set, as latitude and longitude, and your time zone",
    why: "To read the coming days' forecast there. Nothing is written back.",
  },
};
