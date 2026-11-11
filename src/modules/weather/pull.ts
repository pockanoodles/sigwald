/**
 * Weather's pull: three days of forecast in the person's zone. Today's
 * numbers become readings; runs of hours at or above the rain threshold
 * become free-time events ("Rain likely, 80%").
 */
import { fromZonedTime } from "date-fns-tz";

import { ConnectorError } from "@/lib/connectors/errors";
import { forecast } from "@/lib/connectors/openmeteo/client";
import { dayIn } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledEvent,
  type PulledReading,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

const HOUR = 3_600_000;

/** "40.7128, -74.0060" as a place, or null. */
export function parsePlace(text: string): { lat: number; lng: number } | null {
  const m = text
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Consecutive hours at or above `threshold`, as spans with their highest chance. */
export function rainSpans(
  hours: { at: Date; chance: number | null }[],
  threshold: number
): { start: Date; end: Date; peak: number }[] {
  const spans: { start: Date; end: Date; peak: number }[] = [];
  for (const h of hours) {
    if (h.chance === null || h.chance < threshold) continue;
    const last = spans[spans.length - 1];
    const end = new Date(h.at.getTime() + HOUR);
    if (last && last.end.getTime() === h.at.getTime()) {
      last.end = end;
      last.peak = Math.max(last.peak, h.chance);
    } else {
      spans.push({ start: h.at, end, peak: h.chance });
    }
  }
  return spans;
}

export const pullWeather: PullFn = async ({
  http,
  settings,
  now,
  timeZone,
}) => {
  const place = parsePlace(setting.text(settings, "place"));
  if (!place)
    throw new ConnectorError("config", "Set where, as latitude, longitude.");
  const unit =
    setting.text(settings, "unit") === "fahrenheit" ? "fahrenheit" : "celsius";
  const threshold = setting.number(settings, "rainAt", 60);

  const f = await forecast(http, place, timeZone, unit, 3);
  const today = dayIn(now, timeZone);
  const i = f.daily.time.indexOf(today);
  const readings: PulledReading[] = [];
  if (i >= 0) {
    const push = (
      key: string,
      label: string,
      value: number | null,
      u: string
    ) => {
      if (typeof value === "number")
        readings.push({ key, label, value, unit: u });
    };
    push("high", "High", f.daily.temperature_2m_max[i], unit);
    push("low", "Low", f.daily.temperature_2m_min[i], unit);
    push(
      "rain",
      "Chance of rain",
      f.daily.precipitation_probability_max[i],
      "percent"
    );
  }

  const items: PulledEvent[] = [];
  if (setting.on(settings, "rain")) {
    const hours = f.hourly.time.map((t, j) => ({
      // Open-Meteo gives wall-clock hours in the zone it was asked for.
      at: fromZonedTime(`${t}:00`, timeZone),
      chance: f.hourly.precipitation_probability[j] ?? null,
    }));
    for (const span of rainSpans(hours, threshold)) {
      if (span.end <= now) continue;
      items.push({
        kind: "event",
        externalId: `rain:${span.start.toISOString()}`,
        title: `Rain likely, ${span.peak}%`,
        state: "open",
        start: span.start,
        end: span.end,
        busy: false,
      });
    }
  }
  return { items, complete: true, readings };
};
