import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { OPEN_METEO } from "@/lib/connectors/openmeteo/service";

import type { PullContext, PulledEvent } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import weather from "@/modules/weather/manifest";
import { pullWeather, rainSpans } from "@/modules/weather/pull";

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(weather.connect!.settings, {
    place: "40.71, -74.01",
    ...settings,
  }),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const hours = (day: string, chances: number[]) =>
  chances.map((_, h) => `${day}T${String(h).padStart(2, "0")}:00`);

// As api.open-meteo.com answers with timezone=America/New_York.
const forecast = {
  daily: {
    time: ["2026-11-11", "2026-11-12", "2026-11-13"],
    temperature_2m_max: [17.6, 15.1, 12],
    temperature_2m_min: [8.7, 9.6, 6],
    precipitation_probability_max: [0, 92, 10],
  },
  hourly: {
    time: [
      ...hours("2026-11-11", Array(24).fill(0)),
      ...hours("2026-11-12", Array(24).fill(0)),
    ],
    precipitation_probability: [
      ...Array(24).fill(0),
      ...[
        0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 80, 92, 70, 10, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0,
      ],
    ],
  },
};

describe("pullWeather", () => {
  it("reads today's numbers and puts likely rain on the calendar as free time", async () => {
    const { http, calls } = fakeServiceHttp(OPEN_METEO, [
      { url: "https://api.open-meteo.com/v1/forecast", json: forecast },
    ]);
    const result = await pullWeather(ctx(http, {}));
    const asked = new URL(calls[0].url).searchParams;
    expect(asked.get("timezone")).toBe("America/New_York");
    expect(asked.get("latitude")).toBe("40.71");
    expect(result.readings).toEqual([
      { key: "high", label: "High", value: 17.6, unit: "celsius" },
      { key: "low", label: "Low", value: 8.7, unit: "celsius" },
      { key: "rain", label: "Chance of rain", value: 0, unit: "percent" },
    ]);
    const [rain] = result.items as PulledEvent[];
    expect(rain).toMatchObject({
      title: "Rain likely, 92%",
      busy: false,
      // 09:00 to 13:00 in New York (EST, UTC-5).
      start: new Date("2026-11-12T14:00:00.000Z"),
      end: new Date("2026-11-12T18:00:00.000Z"),
    });
  });

  it("asks in Fahrenheit and keeps rain off the calendar when told", async () => {
    const { http, calls } = fakeServiceHttp(OPEN_METEO, [
      { url: "https://api.open-meteo.com/v1/forecast", json: forecast },
    ]);
    const result = await pullWeather(
      ctx(http, { unit: "fahrenheit", rain: false })
    );
    expect(new URL(calls[0].url).searchParams.get("temperature_unit")).toBe(
      "fahrenheit"
    );
    expect(result.items).toEqual([]);
    expect(result.readings?.[0].unit).toBe("fahrenheit");
  });
});

describe("rainSpans", () => {
  it("joins consecutive wet hours and keeps each span's peak", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 12, h));
    expect(
      rainSpans(
        [
          { at: at(1), chance: 70 },
          { at: at(2), chance: 90 },
          { at: at(3), chance: 10 },
          { at: at(4), chance: 60 },
        ],
        60
      )
    ).toEqual([
      { start: at(1), end: at(3), peak: 90 },
      { start: at(4), end: at(5), peak: 60 },
    ]);
  });
});
