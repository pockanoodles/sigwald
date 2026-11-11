import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { NAGER } from "@/lib/connectors/nager/service";

import type { PullContext, PulledEvent } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import holidays from "@/modules/holidays/manifest";
import { pullHolidays } from "@/modules/holidays/pull";

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(holidays.connect!.settings, settings),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

// As date.nager.at answers (GET /api/v3/PublicHolidays/2026/JP).
const jp = (date: string, name: string, localName: string, global = true) => ({
  date,
  localName,
  name,
  countryCode: "JP",
  fixed: false,
  global,
  counties: global ? null : ["JP-13"],
  launchYear: null,
  types: ["Public"],
});

describe("pullHolidays", () => {
  it("puts the year ahead's nationwide holidays on the calendar, all day in the person's zone", async () => {
    const { http, calls } = fakeServiceHttp(NAGER, [
      {
        url: "https://date.nager.at/api/v3/PublicHolidays/2026/JP",
        json: [
          jp("2026-01-01", "New Year's Day", "元日"),
          jp("2026-11-23", "Labour Thanksgiving Day", "勤労感謝の日"),
          jp("2026-11-24", "Local Day", "地方の日", false),
        ],
      },
      {
        url: "https://date.nager.at/api/v3/PublicHolidays/2027/JP",
        json: [jp("2027-01-01", "New Year's Day", "元日")],
      },
    ]);
    const result = await pullHolidays(ctx(http, { countries: ["jp"] }));
    expect(calls.map((c) => c.url)).toHaveLength(2);
    const events = result.items as PulledEvent[];
    expect(events.map((e) => e.title)).toEqual([
      "Labour Thanksgiving Day",
      "New Year's Day",
    ]);
    expect(events[0]).toMatchObject({
      allDay: true,
      busy: false,
      start: new Date("2026-11-23T05:00:00.000Z"),
      end: new Date("2026-11-24T05:00:00.000Z"),
      description: "勤労感謝の日",
    });
  });

  it("names the country when there are several, and can keep the days busy", async () => {
    const { http } = fakeServiceHttp(NAGER, [
      {
        url: /PublicHolidays\/\d{4}\/JP$/,
        json: [jp("2026-11-23", "Labour Thanksgiving Day", "勤労感謝の日")],
      },
      { url: /PublicHolidays\/\d{4}\/US$/, json: [] },
    ]);
    const result = await pullHolidays(
      ctx(http, { countries: ["JP", "US"], busy: true })
    );
    expect(result.items[0]).toMatchObject({
      title: "Labour Thanksgiving Day (JP)",
      busy: true,
    });
  });

  it("says plainly when a country code isn't one it knows", async () => {
    const { http } = fakeServiceHttp(NAGER, [
      { url: /PublicHolidays/, status: 404, text: "" },
    ]);
    await expect(
      pullHolidays(ctx(http, { countries: ["XX"] }))
    ).rejects.toMatchObject({ kind: "config" });
  });
});
