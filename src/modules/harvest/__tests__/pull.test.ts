import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyHarvest } from "@/lib/connectors/harvest/client";
import { HARVEST } from "@/lib/connectors/harvest/service";
import { mondayOf } from "@/lib/connectors/time-windows";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import harvest from "@/modules/harvest/manifest";
import { pullHarvest } from "@/modules/harvest/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const API = "https://api.harvestapp.com/v2";
const config = { accountId: "123456", userId: "9" };

const ctx = (
  http: PullContext["http"],
  open: PullContext["open"] = []
): PullContext => ({
  http,
  secret: { token: "tok" },
  config,
  settings: resolveSettings(harvest.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open,
  lastSuccessAt: null,
});

const entry = (
  id: number,
  spent_date: string,
  hours: number,
  billable: boolean
) => ({
  id,
  spent_date,
  hours,
  billable,
});

const entries = {
  time_entries: [
    entry(1, "2026-11-09", 3.5, true),
    entry(2, "2026-11-10", 2, false),
    entry(3, "2026-11-11", 1.25, true),
  ],
  next_page: null,
};

const overdue = {
  id: 77,
  number: "1042",
  client: { id: 5, name: "Acme" },
  due_date: "2026-11-01",
  state: "open",
  due_amount: 1200,
  amount: 1200,
  currency: "USD",
};

describe("verifyHarvest", () => {
  it("sends the account id and keeps the user id", async () => {
    const { http, calls } = fakeServiceHttp(HARVEST, [
      {
        url: `${API}/users/me`,
        json: { id: 9, first_name: "Ada", last_name: "Lovelace" },
      },
    ]);
    await expect(
      verifyHarvest({ http, secret: { token: "tok" }, config })
    ).resolves.toEqual({ label: "Ada Lovelace", config: { userId: "9" } });
    expect(calls[0].headers["Harvest-Account-Id"]).toBe("123456");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
  });
});

describe("mondayOf", () => {
  it("finds the Monday of the week", () => {
    expect(mondayOf("2026-11-11")).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
  });
});

describe("pullHarvest", () => {
  it("reads hours and makes tasks for overdue invoices", async () => {
    const { http, calls } = fakeServiceHttp(HARVEST, [
      { url: `${API}/time_entries`, json: entries },
      {
        url: `${API}/invoices`,
        json: {
          invoices: [
            overdue,
            { ...overdue, id: 78, due_date: "2026-11-20" },
            { ...overdue, id: 79, due_date: null },
          ],
          next_page: null,
        },
      },
    ]);
    const result = await pullHarvest(ctx(http));
    expect(result.readings).toEqual([
      { key: "hours_today", label: "Hours today", value: 1.25, unit: "hours" },
      {
        key: "hours_week",
        label: "Hours this week",
        value: 6.75,
        unit: "hours",
      },
      {
        key: "billable_week",
        label: "Billable this week",
        value: 4.75,
        unit: "hours",
      },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      externalId: "77",
      title: "Chase invoice 1042 (Acme)",
      state: "open",
      due: { date: "2026-11-01" },
      group: { key: "harvest:client:5", label: "Harvest: Acme" },
    });
    expect(result.complete).toBe(true);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("from")).toBe("2026-11-09");
    expect(q.get("to")).toBe("2026-11-11");
    expect(q.get("user_id")).toBe("9");
    expect(new URL(calls[1].url).searchParams.get("state")).toBe("open");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finishes a held invoice once it is paid; one open but no longer overdue has nothing to chase", async () => {
    const { http } = fakeServiceHttp(HARVEST, [
      { url: `${API}/time_entries`, json: entries },
      { url: `${API}/invoices?`, json: { invoices: [], next_page: null } },
      {
        url: `${API}/invoices/80`,
        json: {
          ...overdue,
          id: 80,
          state: "paid",
          paid_at: "2026-11-10T09:00:00Z",
        },
      },
      { url: `${API}/invoices/81`, json: { ...overdue, id: 81 } },
    ]);
    const result = await pullHarvest(
      ctx(http, [
        { externalId: "80", kind: "task", title: "Chase invoice 7 (Acme)" },
        { externalId: "81", kind: "task", title: "Chase invoice 8 (Acme)" },
      ])
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "80",
        title: "Chase invoice 7 (Acme)",
        state: "done",
        doneAt: new Date("2026-11-10T09:00:00Z"),
      },
      {
        kind: "task",
        externalId: "81",
        title: "Chase invoice 8 (Acme)",
        state: "gone",
      },
    ]);
    expect(result.complete).toBe(true);
  });

  it("leaves readings out when the entries are cut off, and says so for invoices", async () => {
    const { http } = fakeServiceHttp(HARVEST, [
      {
        url: `${API}/time_entries`,
        json: { time_entries: [], next_page: 2 },
      },
      { url: `${API}/invoices`, json: { invoices: [overdue], next_page: 2 } },
    ]);
    const result = await pullHarvest(ctx(http));
    expect(result.readings).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it("keeps the hours when invoices are forbidden", async () => {
    const { http } = fakeServiceHttp(HARVEST, [
      { url: `${API}/time_entries`, json: entries },
      { url: `${API}/invoices`, status: 403, json: { error: "forbidden" } },
    ]);
    const result = await pullHarvest(ctx(http));
    expect(result.readings).toHaveLength(3);
    expect(result.items).toEqual([]);
    expect(result.complete).toBe(false);
  });
});
