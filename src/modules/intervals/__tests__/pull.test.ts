import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyIntervals } from "@/lib/connectors/intervals/client";
import { INTERVALS } from "@/lib/connectors/intervals/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import intervals from "@/modules/intervals/manifest";
import { pullIntervals } from "@/modules/intervals/pull";

const BASE = "https://intervals.icu/api/v1/athlete/i12345";
const secret = { key: "secretkey123" };
const config = { athleteId: "i12345" };
const now = new Date("2026-11-11T15:00:00.000Z");

const workout = (
  id: number,
  day: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  category: "WORKOUT",
  name: `Workout ${id}`,
  type: "Ride",
  start_date_local: `${day}T00:00:00`,
  moving_time: 3600,
  icu_training_load: 60,
  paired_activity_id: null,
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret,
  config,
  settings: resolveSettings(intervals.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyIntervals", () => {
  it("sends Basic API_KEY:<key> and names the athlete", async () => {
    const { http, calls } = fakeServiceHttp(INTERVALS, [
      { url: BASE, json: { id: "i12345", name: "Kai" } },
    ]);
    await expect(verifyIntervals({ http, secret, config })).resolves.toEqual({
      label: "Kai",
    });
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("API_KEY:secretkey123").toString("base64")}`
    );
  });
});

describe("pullIntervals", () => {
  it("makes a task per planned workout, due that day, with minutes and readings", async () => {
    const { http, calls } = fakeServiceHttp(INTERVALS, [
      {
        url: `${BASE}/events`,
        json: [
          workout(1, "2026-11-12"),
          workout(2, "2026-11-11", { moving_time: null, type: "Run" }),
          workout(3, "2026-11-09"),
        ],
      },
      {
        url: `${BASE}/wellness/2026-11-11`,
        json: { id: "2026-11-11", ctl: 52.34, atl: 61.01 },
      },
    ]);
    const result = await pullIntervals(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls[0].url).toContain("oldest=2026-11-08");
    expect(calls[0].url).toContain("newest=2026-11-25");
    expect(calls[0].url).toContain("category=WORKOUT");
    expect(result.complete).toBe(true);
    // The unpaired workout two days ago is past: not listed.
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "Workout 1",
      due: { date: "2026-11-12" },
      minutes: 60,
      group: { key: "intervals:sport:ride", label: "Ride training" },
    });
    expect(result.items[1]).toMatchObject({ minutes: null });
    expect(result.readings).toEqual([
      { key: "fitness", label: "Fitness (CTL)", value: 52.3, unit: "count" },
      { key: "fatigue", label: "Fatigue (ATL)", value: 61, unit: "count" },
      { key: "form", label: "Form", value: -8.7, unit: "count" },
    ]);
  });

  it("finishes a held workout once an activity is paired with it", async () => {
    const { http } = fakeServiceHttp(INTERVALS, [
      {
        url: `${BASE}/events`,
        json: [
          workout(1, "2026-11-11", { paired_activity_id: "i999" }),
          workout(2, "2026-11-10", { paired_activity_id: "i998" }),
        ],
      },
      { url: `${BASE}/wellness/`, status: 404, json: {} },
    ]);
    const result = await pullIntervals(
      ctx(http, {
        open: [{ externalId: "1", kind: "task", title: "Workout 1" }],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "1",
        title: "Workout 1",
        state: "done",
        doneAt: now,
      },
    ]);
    // No wellness record yet today: no readings, not an error.
    expect(result.readings).toEqual([]);
  });
});
