import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyLemonSqueezy } from "@/lib/connectors/lemonsqueezy/client";
import { LEMONSQUEEZY } from "@/lib/connectors/lemonsqueezy/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import lemonsqueezy from "@/modules/lemonsqueezy/manifest";
import { pullLemonSqueezy } from "@/modules/lemonsqueezy/pull";

const API = "https://api.lemonsqueezy.com/v1";

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: { key: "k" },
  config: {},
  settings: resolveSettings(lemonsqueezy.connect!.settings, {}),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const store = (
  id: string,
  currency: string,
  sales: [number, number],
  revenue: [number, number]
) => ({
  type: "stores",
  id,
  attributes: {
    name: `Store ${id}`,
    currency,
    total_sales: sales[0],
    thirty_day_sales: sales[1],
    total_revenue: revenue[0],
    thirty_day_revenue: revenue[1],
  },
});

describe("verifyLemonSqueezy", () => {
  it("names the user and sends the JSON:API headers", async () => {
    const { http, calls } = fakeServiceHttp(LEMONSQUEEZY, [
      {
        url: `${API}/users/me`,
        json: { data: { attributes: { name: "Ada Lovelace" } } },
      },
    ]);
    await expect(
      verifyLemonSqueezy({ http, secret: { key: "k" }, config: {} })
    ).resolves.toEqual({ label: "Ada Lovelace" });
    expect(calls[0].headers.Accept).toBe("application/vnd.api+json");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
  });
});

describe("pullLemonSqueezy", () => {
  it("adds up stores in dollars, since revenue is USD cents whatever the store's currency", async () => {
    const { http, calls } = fakeServiceHttp(LEMONSQUEEZY, [
      {
        url: `${API}/stores`,
        json: {
          data: [
            store("1", "USD", [10, 2], [123456, 5000]),
            store("2", "EUR", [5, 1], [99900, 999]),
          ],
          meta: { page: { currentPage: 1, lastPage: 1 } },
        },
      },
    ]);
    const result = await pullLemonSqueezy(ctx(http));
    expect(result.readings).toEqual([
      {
        key: "revenue_30d",
        label: "Revenue, 30 days",
        value: 59.99,
        unit: "usd",
      },
      {
        key: "revenue_total",
        label: "Revenue, all time",
        value: 2233.56,
        unit: "usd",
      },
      { key: "sales_30d", label: "Sales, 30 days", value: 3, unit: "count" },
      {
        key: "sales_total",
        label: "Sales, all time",
        value: 15,
        unit: "count",
      },
    ]);
    expect(result.items).toEqual([]);
    expect(calls[0].headers["Content-Type"]).toBe("application/vnd.api+json");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("reads every page of stores, and leaves readings out if it can't", async () => {
    const page = (n: number, last: number) => ({
      data: [store(String(n), "USD", [1, 1], [100, 100])],
      meta: { page: { currentPage: n, lastPage: last } },
    });
    const two = fakeServiceHttp(LEMONSQUEEZY, [
      { url: `${API}/stores?page%5Bnumber%5D=1`, json: page(1, 2) },
      { url: `${API}/stores?page%5Bnumber%5D=2`, json: page(2, 2) },
    ]);
    const result = await pullLemonSqueezy(ctx(two.http));
    expect(result.readings?.[3].value).toBe(2);

    const endless = fakeServiceHttp(LEMONSQUEEZY, [
      { url: `${API}/stores`, json: page(1, 99) },
    ]);
    expect(
      (await pullLemonSqueezy(ctx(endless.http))).readings
    ).toBeUndefined();
  });
});
