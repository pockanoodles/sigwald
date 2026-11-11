/**
 * Open-Meteo's forecast, daily and hourly, in the person's zone.
 * Docs: https://open-meteo.com/en/docs (GET /v1/forecast)
 */
import type { Http } from "@/lib/connectors/egress";

export interface OpenMeteoForecast {
  daily: {
    /** YYYY-MM-DD, in the zone asked for. */
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_probability_max: (number | null)[];
  };
  hourly: {
    /** YYYY-MM-DDTHH:mm, in the zone asked for. */
    time: string[];
    precipitation_probability: (number | null)[];
  };
}

export function forecast(
  http: Http,
  place: { lat: number; lng: number },
  timeZone: string,
  unit: "celsius" | "fahrenheit",
  days: number
): Promise<OpenMeteoForecast> {
  return http.json<OpenMeteoForecast>({
    url: "https://api.open-meteo.com/v1/forecast",
    query: {
      latitude: place.lat,
      longitude: place.lng,
      daily:
        "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      hourly: "precipitation_probability",
      temperature_unit: unit,
      timezone: timeZone,
      forecast_days: days,
    },
  });
}
