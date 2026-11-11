import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyUnsplash } from "@/lib/connectors/unsplash/client";
import { UNSPLASH } from "@/lib/connectors/unsplash/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import unsplash from "@/modules/unsplash/manifest";
import { pullUnsplash } from "@/modules/unsplash/pull";

const API = "https://api.unsplash.com";

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: { key: "access-key-abcdefghijkl" },
  config: { username: "janedoe" },
  settings: resolveSettings(unsplash.connect!.settings, {}),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const series = (total: number, values: number[]) => ({
  total,
  historical: {
    change: 1,
    resolution: "days",
    quantity: values.length,
    values: values.map((value, i) => ({ date: `2026-10-${10 + i}`, value })),
  },
});

const stats = {
  username: "janedoe",
  downloads: series(99999, [10, 20, 5]),
  views: series(99999, [100, 200, 50]),
};

describe("verifyUnsplash", () => {
  it("looks the user up with a Client-ID header and keeps the username", async () => {
    const { http, calls } = fakeServiceHttp(UNSPLASH, [
      {
        url: `${API}/users/janedoe`,
        json: { username: "janedoe", name: "Jane Doe", downloads: 5 },
      },
    ]);
    await expect(
      verifyUnsplash({
        http,
        secret: { key: "k123" },
        config: { username: "@janedoe" },
      })
    ).resolves.toEqual({ label: "Jane Doe", config: { username: "janedoe" } });
    expect(calls[0].headers.Authorization).toBe("Client-ID k123");
  });
});

describe("pullUnsplash", () => {
  it("sums the last 30 days and reads the all-time downloads", async () => {
    const { http, calls } = fakeServiceHttp(UNSPLASH, [
      { url: `${API}/users/janedoe/statistics`, json: stats },
      {
        url: `${API}/users/janedoe`,
        json: { username: "janedoe", downloads: 4321 },
      },
    ]);
    const out = await pullUnsplash(ctx(http));
    expect(out.complete).toBe(true);
    expect(out.readings).toEqual([
      {
        key: "downloads30",
        label: "Downloads, 30 days",
        value: 35,
        unit: "count",
      },
      { key: "views30", label: "Views, 30 days", value: 350, unit: "count" },
      {
        key: "downloads_total",
        label: "Downloads, all time",
        value: 4321,
        unit: "count",
      },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(new URL(calls[0].url).searchParams.get("quantity")).toBe("30");
  });

  it("is incomplete when the profile can't be read", async () => {
    const { http } = fakeServiceHttp(UNSPLASH, [
      { url: `${API}/users/janedoe/statistics`, json: stats },
      { url: `${API}/users/janedoe`, status: 500, text: "x" },
    ]);
    const out = await pullUnsplash(ctx(http));
    expect(out.complete).toBe(false);
    expect(out.readings).toHaveLength(2);
  });

  it("falls back to totals when there are no daily values", async () => {
    const { http } = fakeServiceHttp(UNSPLASH, [
      {
        url: `${API}/users/janedoe/statistics`,
        json: { downloads: { total: 7 }, views: { total: 70 } },
      },
      { url: `${API}/users/janedoe`, json: { username: "janedoe" } },
    ]);
    const out = await pullUnsplash(ctx(http));
    expect(out.readings?.map((r) => r.value)).toEqual([7, 70]);
  });
});
