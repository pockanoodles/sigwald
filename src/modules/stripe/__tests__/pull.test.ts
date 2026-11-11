import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { fromMinor, verifyStripe } from "@/lib/connectors/stripe/client";
import { STRIPE } from "@/lib/connectors/stripe/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import stripe from "@/modules/stripe/manifest";
import { monthly, pullStripe } from "@/modules/stripe/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const API = "https://api.stripe.com/v1";

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: { key: "rk_live_x" },
  config: {},
  settings: resolveSettings(stripe.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const price = (
  unit_amount: number,
  interval: "month" | "year",
  interval_count = 1,
  currency = "usd"
) => ({
  currency,
  unit_amount,
  recurring: { interval, interval_count },
});

describe("verifyStripe", () => {
  it("says which mode the key is for, pinned to one API version", async () => {
    const { http, calls } = fakeServiceHttp(STRIPE, [
      {
        url: `${API}/balance`,
        json: { livemode: true, available: [], pending: [] },
      },
    ]);
    await expect(
      verifyStripe({ http, secret: { key: "rk_live_x" }, config: {} })
    ).resolves.toEqual({ label: "Live account" });
    expect(calls[0].headers["Stripe-Version"]).toBe("2024-06-20");
  });
});

describe("pullStripe", () => {
  it("reads balance, MRR and 30-day charges, and makes tasks for disputes needing an answer", async () => {
    const { http, calls } = fakeServiceHttp(STRIPE, [
      {
        url: /\/v1\/balance$/,
        json: {
          livemode: true,
          available: [
            { amount: 125050, currency: "usd" },
            { amount: 999, currency: "eur" },
          ],
          pending: [{ amount: 5000, currency: "usd" }],
        },
      },
      {
        url: `${API}/subscriptions`,
        json: {
          has_more: false,
          data: [
            {
              id: "sub_1",
              items: {
                data: [
                  { id: "si_1", quantity: 2, price: price(1500, "month") },
                ],
              },
            },
            {
              id: "sub_2",
              items: {
                data: [
                  { id: "si_2", quantity: 1, price: price(12000, "year") },
                ],
              },
            },
            {
              id: "sub_3",
              items: {
                data: [
                  {
                    id: "si_3",
                    quantity: 1,
                    price: price(900, "month", 1, "eur"),
                  },
                ],
              },
            },
          ],
        },
      },
      {
        url: `${API}/balance_transactions`,
        json: {
          has_more: false,
          data: [
            { id: "txn_1", amount: 2000, currency: "usd", type: "charge" },
          ],
        },
      },
      {
        url: `${API}/disputes`,
        json: {
          has_more: false,
          data: [
            {
              id: "dp_1",
              amount: 4999,
              currency: "usd",
              status: "needs_response",
              reason: "product_not_received",
              charge: "ch_1",
              livemode: true,
              created: 1762800000,
              evidence_details: { due_by: 1763500000, submission_count: 0 },
            },
            {
              id: "dp_2",
              amount: 100,
              currency: "usd",
              status: "won",
              reason: "fraudulent",
              charge: null,
              livemode: true,
              created: 1762000000,
              evidence_details: null,
            },
          ],
        },
      },
    ]);
    const result = await pullStripe(ctx(http));
    expect(result.readings).toEqual([
      { key: "balance", label: "Available", value: 1250.5, unit: "usd" },
      { key: "pending", label: "Pending", value: 50, unit: "usd" },
      { key: "mrr", label: "MRR", value: 40, unit: "usd" },
      { key: "charges30", label: "Charges, 30 days", value: 20, unit: "usd" },
    ]);
    expect(result.items[0]).toMatchObject({
      externalId: "dp_1",
      title: "Answer the $49.99 dispute",
      state: "open",
      due: { at: new Date(1763500000 * 1000) },
      impact: 0.9,
      url: "https://dashboard.stripe.com/disputes/dp_1",
    });
    expect(result.items[1]).toMatchObject({
      externalId: "dp_2",
      state: "done",
    });
    expect(new URL(calls[2].url).searchParams.get("created[gte]")).toBe(
      String(Math.floor((now.getTime() - 30 * 86_400_000) / 1000))
    );
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("money", () => {
  it("counts each currency in its own units", () => {
    expect(fromMinor(1234, "usd")).toBe(12.34);
    expect(fromMinor(1234, "jpy")).toBe(1234);
    expect(fromMinor(1234, "kwd")).toBe(1.234);
    expect(
      monthly({ id: "x", quantity: null, price: price(1200, "year") })
    ).toBe(100);
    expect(
      monthly({ id: "x", quantity: 1, price: price(1000, "month", 3) })
    ).toBeCloseTo(333.33, 1);
  });
});
