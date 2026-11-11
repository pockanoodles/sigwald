import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyYnab } from "@/lib/connectors/ynab/client";
import { YNAB } from "@/lib/connectors/ynab/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import ynab from "@/modules/ynab/manifest";
import { pullYnab } from "@/modules/ynab/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const API = "https://api.ynab.com/v1";

const ctx = (
  http: PullContext["http"],
  open: PullContext["open"] = []
): PullContext => ({
  http,
  secret: { token: "t" },
  config: {},
  settings: resolveSettings(ynab.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open,
  lastSuccessAt: null,
});

const settings = {
  url: `${API}/plans/last-used/settings`,
  json: {
    data: {
      settings: {
        currency_format: { iso_code: "USD" },
        date_format: { format: "MM/DD/YYYY" },
      },
    },
  },
};

const category = (id: string, name: string, balance: number, extra = {}) => ({
  id,
  name,
  balance,
  hidden: false,
  deleted: false,
  ...extra,
});

const month = (categories: unknown[]) => ({
  url: `${API}/plans/last-used/months/2026-11-01`,
  json: {
    data: {
      month: {
        month: "2026-11-01",
        to_be_budgeted: 123450,
        age_of_money: 41,
        categories,
      },
    },
  },
});

const waiting = (n: number) => ({
  url: `${API}/plans/last-used/transactions`,
  json: {
    data: {
      transactions: Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        approved: false,
        deleted: false,
      })),
      server_knowledge: 1,
    },
  },
});

describe("verifyYnab", () => {
  it("checks the token with the user endpoint", async () => {
    const { http, calls } = fakeServiceHttp(YNAB, [
      { url: `${API}/user`, json: { data: { user: { id: "u" } } } },
    ]);
    await expect(
      verifyYnab({ http, secret: { token: "t" }, config: {} })
    ).resolves.toEqual({ label: "YNAB account" });
    expect(calls[0].headers.Authorization).toBe("Bearer t");
  });
});

describe("pullYnab", () => {
  it("reads Ready to Assign and age of money, and makes tasks", async () => {
    const { http, calls } = fakeServiceHttp(YNAB, [
      settings,
      month([
        category("c1", "Groceries", -45500),
        category("c2", "Rent", 0),
        category("c3", "Fun", 5000),
        category("c4", "Old", -100, { hidden: true }),
      ]),
      waiting(3),
    ]);
    const result = await pullYnab(ctx(http));
    expect(result.readings).toEqual([
      {
        key: "ready_to_assign",
        label: "Ready to Assign",
        value: 123.45,
        unit: "usd",
      },
      {
        key: "age_of_money",
        label: "Age of money, days",
        value: 41,
        unit: "count",
      },
    ]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "approve:last-used",
      title: "Approve 3 transactions",
      state: "open",
      group: { key: "ynab:budget:last-used" },
    });
    expect(result.items[1]).toMatchObject({
      externalId: "cover:2026-11:c1",
      title: "Cover Groceries",
      state: "open",
    });
    expect(result.complete).toBe(true);
    expect(new URL(calls[2].url).searchParams.get("type")).toBe("unapproved");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finishes held tasks once nothing is left", async () => {
    const { http } = fakeServiceHttp(YNAB, [
      settings,
      month([category("c1", "Groceries", 1000)]),
      waiting(0),
    ]);
    const result = await pullYnab(
      ctx(http, [
        {
          externalId: "approve:last-used",
          kind: "task",
          title: "Approve 3 transactions",
        },
        {
          externalId: "cover:2026-11:c1",
          kind: "task",
          title: "Cover Groceries",
        },
        // Last month's, never covered: the month turned, not the person.
        { externalId: "cover:2026-10:c9", kind: "task", title: "Cover Dining" },
        { externalId: "other", kind: "task", title: "Untouched" },
      ])
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "approve:last-used",
        title: "Approve 3 transactions",
        state: "done",
        doneAt: now,
      },
      {
        kind: "task",
        externalId: "cover:2026-11:c1",
        title: "Cover Groceries",
        state: "done",
        doneAt: now,
      },
      {
        kind: "task",
        externalId: "cover:2026-10:c9",
        title: "Cover Dining",
        state: "gone",
      },
    ]);
  });

  it("leaves Ready to Assign out when the budget has no currency, and uses the budget setting", async () => {
    const id = "1c3a1c3a-1c3a-1c3a-1c3a-1c3a1c3a1c3a";
    const { http, calls } = fakeServiceHttp(YNAB, [
      {
        url: `${API}/plans/${id}/settings`,
        json: { data: { settings: { currency_format: null } } },
      },
      {
        url: `${API}/plans/${id}/months/2026-11-01`,
        json: {
          data: {
            month: { to_be_budgeted: 1000, age_of_money: null, categories: [] },
          },
        },
      },
      {
        url: `${API}/plans/${id}/transactions`,
        json: { data: { transactions: [] } },
      },
    ]);
    const c = ctx(http);
    const result = await pullYnab({
      ...c,
      settings: resolveSettings(ynab.connect!.settings, { budget: id }),
    });
    expect(result.readings).toEqual([]);
    expect(calls).toHaveLength(3);
  });
});
