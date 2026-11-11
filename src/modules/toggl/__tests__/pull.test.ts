import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyToggl } from "@/lib/connectors/toggl/client";
import { TOGGL } from "@/lib/connectors/toggl/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import toggl from "@/modules/toggl/manifest";
import { pullToggl } from "@/modules/toggl/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const API = "https://api.track.toggl.com/api/v9";

const ctx = (http: PullContext["http"], timeZone = "UTC"): PullContext => ({
  http,
  secret: { token: "abc" },
  config: {},
  settings: resolveSettings(toggl.connect!.settings, {}),
  now,
  timeZone,
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("verifyToggl", () => {
  it("signs in with the token as Basic auth", async () => {
    const { http, calls } = fakeServiceHttp(TOGGL, [
      { url: `${API}/me`, json: { id: 1, fullname: "Ada Lovelace" } },
    ]);
    await expect(
      verifyToggl({ http, secret: { token: "abc" }, config: {} })
    ).resolves.toEqual({ label: "Ada Lovelace" });
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("abc:api_token").toString("base64")}`
    );
  });
});

describe("pullToggl", () => {
  it("totals today and this week, counting a running timer up to now", async () => {
    const { http, calls } = fakeServiceHttp(TOGGL, [
      {
        url: `${API}/me/time_entries`,
        json: [
          // Monday, 2h
          {
            id: 1,
            start: "2026-11-09T09:00:00+00:00",
            stop: "2026-11-09T11:00:00+00:00",
            duration: 7200,
          },
          // Wednesday morning, 1.5h
          {
            id: 2,
            start: "2026-11-11T08:00:00+00:00",
            stop: "2026-11-11T09:30:00+00:00",
            duration: 5400,
          },
          // Running since 13:00 today: 2h to now
          {
            id: 3,
            start: "2026-11-11T13:00:00+00:00",
            stop: null,
            duration: -1,
          },
          // Sunday night across midnight: 1h of it is Monday
          {
            id: 4,
            start: "2026-11-08T23:00:00+00:00",
            stop: "2026-11-09T01:00:00+00:00",
            duration: 7200,
          },
        ],
      },
    ]);
    const result = await pullToggl(ctx(http));
    expect(result.readings).toEqual([
      { key: "hours_today", label: "Hours today", value: 3.5, unit: "hours" },
      {
        key: "hours_week",
        label: "Hours this week",
        value: 6.5,
        unit: "hours",
      },
    ]);
    expect(result.complete).toBe(true);
    expect(new URL(calls[0].url).searchParams.get("end_date")).toBe(
      "2026-11-12T00:00:00.000Z"
    );
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finds today in the person's zone", async () => {
    const { http } = fakeServiceHttp(TOGGL, [
      {
        url: `${API}/me/time_entries`,
        json: [
          // 2026-11-11T03:00Z is still Nov 10 in New York
          {
            id: 1,
            start: "2026-11-11T03:00:00+00:00",
            stop: "2026-11-11T04:00:00+00:00",
            duration: 3600,
          },
        ],
      },
    ]);
    const result = await pullToggl(ctx(http, "America/New_York"));
    expect(result.readings?.[0].value).toBe(0);
    expect(result.readings?.[1].value).toBe(1);
  });

  it("leaves the readings out when the list is full", async () => {
    const entry = {
      id: 1,
      start: "2026-11-10T09:00:00+00:00",
      stop: "2026-11-10T10:00:00+00:00",
      duration: 3600,
    };
    const { http } = fakeServiceHttp(TOGGL, [
      { url: `${API}/me/time_entries`, json: Array(1000).fill(entry) },
    ]);
    const result = await pullToggl(ctx(http));
    expect(result.readings).toBeUndefined();
  });
});
