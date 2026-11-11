import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyKit } from "@/lib/connectors/kit/client";
import { KIT } from "@/lib/connectors/kit/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import kit from "@/modules/kit/manifest";
import { pullKit } from "@/modules/kit/pull";

const API = "https://api.kit.com/v4";
const now = new Date("2026-11-11T15:00:00.000Z");

const broadcast = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  subject: `Letter ${id}`,
  created_at: "2026-11-09T10:00:00Z",
  send_at: null,
  published_at: null,
  ...over,
});

const list = (broadcasts: unknown[], has_next_page = false) => ({
  broadcasts,
  pagination: {
    has_previous_page: false,
    has_next_page,
    start_cursor: "a",
    end_cursor: "b",
    per_page: 100,
  },
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { key: "kit_secretkeyvalue" },
  config: { name: "The Letter", accountId: "55" },
  settings: resolveSettings(kit.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const subscribers = {
  subscribers: [{ id: 1 }],
  pagination: { has_next_page: true, total_count: 987 },
};

describe("verifyKit", () => {
  it("sends the key in X-Kit-Api-Key and names the account", async () => {
    const { http, calls } = fakeServiceHttp(KIT, [
      {
        url: `${API}/account`,
        json: {
          user: { email: "k@x.io", id: 1 },
          account: { id: 55, name: "The Letter", plan_type: "creator" },
        },
      },
    ]);
    await expect(
      verifyKit({ http, secret: { key: "k1" }, config: {} })
    ).resolves.toEqual({
      label: "The Letter",
      config: { name: "The Letter", accountId: "55" },
    });
    expect(calls[0].headers["X-Kit-Api-Key"]).toBe("k1");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});

describe("pullKit", () => {
  it("makes tasks of drafts, events of future sends and a subscribers reading", async () => {
    const { http, calls } = fakeServiceHttp(KIT, [
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=draft`),
        json: list([broadcast(1)]),
      },
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=scheduled`),
        json: list([
          broadcast(2, { send_at: "2026-11-13T13:00:00Z" }),
          broadcast(3, { send_at: "2026-11-10T13:00:00Z" }),
        ]),
      },
      { url: new RegExp(`${API}/subscribers\\?`), json: subscribers },
    ]);
    const result = await pullKit(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      kind: "task",
      externalId: "1",
      title: "Finish: Letter 1",
      group: { key: "kit:account:55", label: "The Letter" },
    });
    expect(result.items[1]).toMatchObject({
      kind: "event",
      externalId: "scheduled:2",
      title: "Sends: Letter 2",
      busy: false,
      start: new Date("2026-11-13T13:00:00Z"),
      end: new Date("2026-11-13T13:15:00Z"),
    });
    expect(result.readings).toEqual([
      { key: "subscribers", label: "Subscribers", value: 987, unit: "count" },
    ]);
    const count = calls.find((c) => c.url.includes("/subscribers"))!.url;
    expect(count).toContain("include_total_count=true");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finishes a held draft once Kit says it was sent", async () => {
    const { http } = fakeServiceHttp(KIT, [
      { url: new RegExp(`${API}/broadcasts\\?.*status=draft`), json: list([]) },
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=scheduled`),
        json: list([]),
      },
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=completed`),
        json: list([broadcast(9, { published_at: "2026-11-11T09:00:00Z" })]),
      },
      { url: new RegExp(`${API}/subscribers\\?`), json: subscribers },
    ]);
    const result = await pullKit(
      ctx(http, {
        open: [{ externalId: "9", kind: "task", title: "Finish: Old" }],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "9",
        title: "Finish: Old",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00Z"),
      },
    ]);
  });

  it("finishes a held draft once it's scheduled, and vouches for nothing past a cut-off schedule", async () => {
    const { http } = fakeServiceHttp(KIT, [
      { url: new RegExp(`${API}/broadcasts\\?.*status=draft`), json: list([]) },
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=scheduled`),
        json: list([broadcast(9, { send_at: "2026-11-14T13:00:00Z" })], true),
      },
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=completed`),
        json: list([]),
      },
      { url: new RegExp(`${API}/subscribers\\?`), json: subscribers },
    ]);
    const result = await pullKit(
      ctx(http, {
        open: [{ externalId: "9", kind: "task", title: "Finish: Old" }],
      })
    );
    expect(result.items).toContainEqual({
      kind: "task",
      externalId: "9",
      title: "Finish: Old",
      state: "done",
      doneAt: now,
    });
    expect(result.complete).toBe(false);
  });

  it("says it is partial when Kit has more drafts than one page", async () => {
    const { http } = fakeServiceHttp(KIT, [
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=draft`),
        json: list([broadcast(1)], true),
      },
      {
        url: new RegExp(`${API}/broadcasts\\?.*status=scheduled`),
        json: list([]),
      },
      { url: new RegExp(`${API}/subscribers\\?`), json: subscribers },
    ]);
    expect((await pullKit(ctx(http))).complete).toBe(false);
  });
});
