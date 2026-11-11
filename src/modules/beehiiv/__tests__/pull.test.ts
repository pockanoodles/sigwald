import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyBeehiiv } from "@/lib/connectors/beehiiv/client";
import { BEEHIIV } from "@/lib/connectors/beehiiv/service";

import beehiiv from "@/modules/beehiiv/manifest";
import { pullBeehiiv } from "@/modules/beehiiv/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const PUB = "pub_00000000-0000-0000-0000-000000000000";
const API = `https://api.beehiiv.com/v2/publications/${PUB}`;
const now = new Date("2026-11-11T15:00:00.000Z");
const secs = (iso: string) => Date.parse(iso) / 1000;

const post = (
  id: string,
  status: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  title: `Issue ${id}`,
  status,
  publish_date: null,
  web_url: null,
  created: secs("2026-11-09T10:00:00Z"),
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { key: "bh_secretkeyvalue" },
  config: { publicationId: PUB, name: "The Letter" },
  settings: resolveSettings(beehiiv.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const page = (data: unknown[], total_pages = 1) => ({
  data,
  limit: 100,
  page: 1,
  total_results: data.length,
  total_pages,
});

const stats = {
  data: { id: PUB, name: "The Letter", stats: { active_subscriptions: 4321 } },
};

describe("verifyBeehiiv", () => {
  it("reads the publication with a Bearer key", async () => {
    const { http, calls } = fakeServiceHttp(BEEHIIV, [
      { url: API, json: { data: { id: PUB, name: "The Letter" } } },
    ]);
    await expect(
      verifyBeehiiv({
        http,
        secret: { key: "k1" },
        config: { publicationId: PUB },
      })
    ).resolves.toEqual({ label: "The Letter", config: { name: "The Letter" } });
    expect(calls[0].headers.Authorization).toBe("Bearer k1");
  });
});

describe("pullBeehiiv", () => {
  it("makes tasks of drafts, events of future sends and a subscribers reading", async () => {
    const { http, calls } = fakeServiceHttp(BEEHIIV, [
      {
        url: new RegExp(`${API}/posts\\?.*status=draft`),
        json: page([post("post_1", "draft")]),
      },
      {
        url: new RegExp(`${API}/posts\\?.*status=confirmed`),
        json: page([
          post("post_2", "confirmed", {
            publish_date: secs("2026-11-13T13:00:00Z"),
          }),
          post("post_3", "confirmed", {
            publish_date: secs("2026-11-01T13:00:00Z"),
          }),
        ]),
      },
      { url: new RegExp(`${API}\\?.*stat_active_subscriptions`), json: stats },
    ]);
    const result = await pullBeehiiv(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      kind: "task",
      externalId: "post_1",
      title: "Finish: Issue post_1",
      group: { key: `beehiiv:publication:${PUB}`, label: "The Letter" },
    });
    expect(result.items[1]).toMatchObject({
      kind: "event",
      externalId: "scheduled:post_2",
      title: "Sends: Issue post_2",
      busy: false,
      start: new Date("2026-11-13T13:00:00Z"),
      end: new Date("2026-11-13T13:15:00Z"),
    });
    expect(result.readings).toEqual([
      { key: "subscribers", label: "Subscribers", value: 4321, unit: "count" },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finishes a held draft that has been sent or scheduled", async () => {
    const { http } = fakeServiceHttp(BEEHIIV, [
      { url: new RegExp(`${API}/posts\\?.*status=draft`), json: page([]) },
      {
        url: new RegExp(`${API}/posts\\?.*status=confirmed`),
        json: page([
          post("post_7", "confirmed", {
            publish_date: secs("2026-11-11T09:00:00Z"),
          }),
          post("post_8", "confirmed", {
            publish_date: secs("2026-11-14T09:00:00Z"),
          }),
        ]),
      },
      { url: new RegExp(`${API}\\?`), json: stats },
    ]);
    const result = await pullBeehiiv(
      ctx(http, {
        open: [
          { externalId: "post_7", kind: "task", title: "Finish: A" },
          { externalId: "post_8", kind: "task", title: "Finish: B" },
        ],
      })
    );
    const done = result.items.filter((i) => i.kind === "task");
    expect(done).toEqual([
      {
        kind: "task",
        externalId: "post_7",
        title: "Finish: A",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00Z"),
      },
      {
        kind: "task",
        externalId: "post_8",
        title: "Finish: B",
        state: "done",
        doneAt: now,
      },
    ]);
  });

  it("says it is partial when there are more drafts than one page", async () => {
    const { http } = fakeServiceHttp(BEEHIIV, [
      {
        url: new RegExp(`${API}/posts\\?.*status=draft`),
        json: page([post("post_1", "draft")], 2),
      },
      { url: new RegExp(`${API}/posts\\?.*status=confirmed`), json: page([]) },
      { url: new RegExp(`${API}\\?`), json: stats },
    ]);
    expect((await pullBeehiiv(ctx(http))).complete).toBe(false);
  });
});
