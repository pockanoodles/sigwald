import { createHttp } from "@/lib/connectors/egress";
import { NOTHING_LEAVES } from "@/lib/connectors/policy";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import daylight from "@/modules/daylight/manifest";
import { pullDaylight } from "@/modules/daylight/pull";
import {
  SUNRISE,
  lightWindows,
  parsePlace,
  sunCrossings,
} from "@/modules/daylight/sun";

const MIN = 60_000;

describe("the sun", () => {
  it("rises and sets within a few minutes of the almanac", () => {
    // New York, 2026-11-20: 11:48 and 21:34 UTC (Open-Meteo).
    const day = new Date(Date.UTC(2026, 10, 20, 17));
    const c = sunCrossings(day, 40.7128, -74.006, [SUNRISE]).crossings.get(
      SUNRISE
    )!;
    expect(
      Math.abs(c.rising!.getTime() - Date.UTC(2026, 10, 20, 11, 48))
    ).toBeLessThan(4 * MIN);
    expect(
      Math.abs(c.setting!.getTime() - Date.UTC(2026, 10, 20, 21, 34))
    ).toBeLessThan(4 * MIN);
  });

  it("orders each day's light: blue, golden, …, golden, blue", () => {
    const windows = lightWindows(
      new Date(Date.UTC(2026, 5, 21, 17)),
      40.7128,
      -74.006
    );
    expect(windows.map((w) => `${w.part} ${w.kind}`)).toEqual([
      "morning blue",
      "morning golden",
      "evening golden",
      "evening blue",
    ]);
    for (let i = 1; i < windows.length; i++)
      expect(windows[i].start >= windows[i - 1].end).toBe(true);
  });

  it("has no golden hour where the sun doesn't rise", () => {
    // Svalbard in polar night.
    expect(
      lightWindows(new Date(Date.UTC(2026, 11, 21, 12)), 78.22, 15.65).filter(
        (w) => w.kind === "golden"
      )
    ).toEqual([]);
  });

  it("reads a place as maps give it", () => {
    expect(parsePlace("40.7128, -74.0060")).toEqual({
      lat: 40.7128,
      lng: -74.006,
    });
    expect(parsePlace("91, 0")).toBeNull();
    expect(parsePlace("Brooklyn")).toBeNull();
  });
});

describe("pullDaylight", () => {
  const ctx = (
    settings: Record<string, unknown>,
    now = new Date("2026-11-11T15:00:00.000Z")
  ): PullContext => ({
    http: createHttp(NOTHING_LEAVES),
    secret: {},
    config: {},
    settings: resolveSettings(daylight.connect!.settings, settings),
    now,
    timeZone: "America/New_York",
    cursor: null,
    open: [],
    lastSuccessAt: null,
  });

  it("puts the coming days' golden hours on the calendar as free time, reaching nothing", async () => {
    const result = await pullDaylight(
      ctx({ place: "40.7128, -74.0060", label: "Brooklyn", days: 3 })
    );
    expect(result.complete).toBe(true);
    const ids = result.items.map((i) => i.externalId);
    expect(ids).toContain("2026-11-11:evening:golden");
    expect(ids).not.toContain("2026-11-11:morning:golden"); // already over at 15:00 UTC
    expect(ids.some((id) => id.endsWith(":blue"))).toBe(false);
    expect(
      result.items.every(
        (i) =>
          i.kind === "event" && i.busy === false && i.location === "Brooklyn"
      )
    ).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adds blue hour and leaves out mornings when asked", async () => {
    const result = await pullDaylight(
      ctx({ place: "40.7128, -74.0060", blue: true, morning: false, days: 2 })
    );
    expect(result.items.some((i) => i.title === "Blue hour")).toBe(true);
    expect(result.items.some((i) => i.externalId.includes(":morning:"))).toBe(
      false
    );
  });
});
