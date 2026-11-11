/**
 * Golden hour's pull, which reaches nothing: it works out the light for the
 * days ahead at the place set, and the framework puts it on the calendar.
 * Days are the place's own (solar noon there), not the person's zone, so a
 * trip abroad still gets that place's mornings.
 */
import { ConnectorError } from "@/lib/connectors/errors";

import { type PullFn, type PulledEvent } from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

import { lightWindows, parsePlace } from "./sun";

const NAMES = {
  golden: "Golden hour",
  blue: "Blue hour",
} as const;

export const pullDaylight: PullFn = async ({ settings, now }) => {
  const place = parsePlace(setting.text(settings, "place"));
  if (!place) {
    throw new ConnectorError("config", "Set where, as latitude, longitude.");
  }
  const label = setting.text(settings, "label") || null;
  const days = setting.number(settings, "days", 7);
  const parts = new Set([
    ...(setting.on(settings, "morning") ? ["morning"] : []),
    ...(setting.on(settings, "evening") ? ["evening"] : []),
  ]);
  const withBlue = setting.on(settings, "blue");

  // Today's solar noon at the place, then a day at a time.
  const firstNoon =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12) -
    (place.lng / 15) * 3_600_000;
  const items: PulledEvent[] = [];
  for (let i = -1; i <= days; i++) {
    const noon = new Date(firstNoon + i * 86_400_000);
    const day = new Date(noon.getTime() + (place.lng / 15) * 3_600_000)
      .toISOString()
      .slice(0, 10);
    for (const w of lightWindows(noon, place.lat, place.lng)) {
      if (!parts.has(w.part) || (w.kind === "blue" && !withBlue)) continue;
      if (w.end <= now) continue;
      items.push({
        kind: "event",
        externalId: `${day}:${w.part}:${w.kind}`,
        title: NAMES[w.kind],
        state: "open",
        start: w.start,
        end: w.end,
        busy: false,
        location: label,
      });
    }
  }
  return { items, complete: true };
};
