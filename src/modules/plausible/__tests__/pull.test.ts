import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyPlausible } from "@/lib/connectors/plausible/client";
import { PLAUSIBLE } from "@/lib/connectors/plausible/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import plausible from "@/modules/plausible/manifest";
import { pullPlausible } from "@/modules/plausible/pull";

const SITE = "https://stats.example.com";
const API = `${SITE}/api/v2/query`;
const config = { site: SITE, domain: "example.com" };
const secret = { token: "plausible-stats-key-123" };
const now = new Date("2026-11-11T15:00:00.000Z");

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret,
  config,
  settings: resolveSettings(plausible.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const answer = (metrics: (number | null)[]) => ({
  results: [{ metrics, dimensions: [] }],
  meta: {},
  query: {},
});

describe("verifyPlausible", () => {
  it("queries today with a bearer key and names the site", async () => {
    const { http, calls } = fakeServiceHttp(
      PLAUSIBLE,
      [{ method: "POST", url: API, json: answer([12]) }],
      config
    );
    await expect(verifyPlausible({ http, secret, config })).resolves.toEqual({
      label: "example.com",
    });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${secret.token}`);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      site_id: "example.com",
      metrics: ["visitors"],
      date_range: "day",
    });
  });

  it("reads a refused key as an auth error", async () => {
    const { http } = fakeServiceHttp(
      PLAUSIBLE,
      [{ method: "POST", url: API, status: 401, json: { error: "Invalid" } }],
      config
    );
    await expect(
      verifyPlausible({ http, secret, config })
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("pullPlausible", () => {
  it("makes readings from today and the last 30 days, and no tasks", async () => {
    const { http, calls } = fakeServiceHttp(
      PLAUSIBLE,
      [
        {
          method: "POST",
          url: API,
          body: /"date_range":"day"/,
          json: answer([37]),
        },
        {
          method: "POST",
          url: API,
          body: /"date_range":"30d"/,
          json: answer([1200, 3400, 52.46]),
        },
      ],
      config
    );
    const result = await pullPlausible(ctx(http));
    expect(calls.every((c) => c.method === "POST")).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.readings).toEqual([
      {
        key: "visitors_today",
        label: "Visitors today",
        value: 37,
        unit: "count",
      },
      {
        key: "visitors_30d",
        label: "Visitors, 30 days",
        value: 1200,
        unit: "count",
      },
      {
        key: "pageviews_30d",
        label: "Pageviews, 30 days",
        value: 3400,
        unit: "count",
      },
      {
        key: "bounce_30d",
        label: "Bounce rate, 30 days",
        value: 52.5,
        unit: "percent",
      },
    ]);
  });

  it("leaves out a number Plausible has none for", async () => {
    const { http } = fakeServiceHttp(
      PLAUSIBLE,
      [
        { method: "POST", url: API, body: /"day"/, json: answer([0]) },
        { method: "POST", url: API, body: /"30d"/, json: answer([0, 0, null]) },
      ],
      config
    );
    const result = await pullPlausible(ctx(http));
    expect(result.readings?.map((r) => r.key)).toEqual([
      "visitors_today",
      "visitors_30d",
      "pageviews_30d",
    ]);
  });
});
