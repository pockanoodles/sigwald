import {
  type Route,
  fakeServiceHttp,
} from "@/lib/connectors/__tests__/fake-http";
import {
  transistorTime,
  verifyTransistor,
} from "@/lib/connectors/transistor/client";
import { TRANSISTOR } from "@/lib/connectors/transistor/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import transistor from "@/modules/transistor/manifest";
import { pullTransistor } from "@/modules/transistor/pull";

const API = "https://api.transistor.fm/v1";
const now = new Date("2026-11-11T15:00:00.000Z");

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {},
  settings: Record<string, unknown> = {}
): PullContext => ({
  http,
  secret: { key: "tr_abcdefghijklmnop" },
  config: {},
  settings: resolveSettings(transistor.connect!.settings, settings),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const show = {
  id: "132543",
  type: "show",
  attributes: { title: "The Caffeine Show", slug: "the-caffeine-show" },
};
const episode = (id: string, status: string, over = {}) => ({
  id,
  type: "episode",
  attributes: {
    title: `Episode ${id}`,
    status,
    published_at: null,
    share_url: `https://share.transistor.fm/s/${id}`,
    ...over,
  },
  relationships: { show: { data: { id: "132543", type: "show" } } },
});

const routes = (extra: Route[] = []) => [
  ...extra,
  { url: `${API}/shows`, json: { data: [show], meta: { totalPages: 1 } } },
  {
    url: `${API}/episodes?`,
    json: { data: [], meta: { totalPages: 1 } },
  },
  {
    url: `${API}/analytics/132543`,
    json: {
      data: {
        id: "the-caffeine-show",
        attributes: {
          downloads: [
            { date: "11-10-2026", downloads: 40 },
            { date: "11-11-2026", downloads: 2 },
          ],
        },
      },
    },
  },
];

describe("verifyTransistor", () => {
  it("names the user, sending the key in x-api-key", async () => {
    const { http, calls } = fakeServiceHttp(TRANSISTOR, [
      { url: API, json: { data: { id: "1", attributes: { name: "Kaito" } } } },
    ]);
    await expect(
      verifyTransistor({ http, secret: { key: "k" }, config: {} })
    ).resolves.toEqual({ label: "Kaito" });
    expect(calls[0].headers["x-api-key"]).toBe("k");
  });
});

describe("transistorTime", () => {
  it("reads Transistor's UTC format", () => {
    expect(transistorTime("2026-11-12 16:00:00 UTC")?.toISOString()).toBe(
      "2026-11-12T16:00:00.000Z"
    );
    expect(transistorTime(null)).toBeNull();
  });
});

describe("pullTransistor", () => {
  it("makes tasks for drafts and free events for scheduled episodes, and a downloads reading", async () => {
    const { http, calls } = fakeServiceHttp(TRANSISTOR, [
      {
        url: /\/episodes\?.*status=draft/,
        json: { data: [episode("11", "draft")], meta: { totalPages: 1 } },
      },
      {
        url: /\/episodes\?.*status=scheduled/,
        json: {
          data: [
            episode("12", "scheduled", {
              published_at: "2026-11-12 16:00:00 UTC",
            }),
          ],
          meta: { totalPages: 1 },
        },
      },
      ...routes(),
    ]);
    const out = await pullTransistor(ctx(http));
    expect(out.complete).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      kind: "task",
      externalId: "episode:11",
      title: "Finish episode: Episode 11",
      state: "open",
      group: {
        key: "transistor:show:132543",
        label: "The Caffeine Show",
      },
    });
    expect(out.items[1]).toMatchObject({
      kind: "event",
      externalId: "release:12",
      busy: false,
      start: new Date("2026-11-12T16:00:00.000Z"),
    });
    expect(out.readings).toEqual([
      {
        key: "downloads30",
        label: "Downloads, 30 days",
        value: 42,
        unit: "count",
      },
    ]);
    const analytics = calls.find((c) => c.url.includes("/analytics/"))!;
    const q = new URL(analytics.url).searchParams;
    expect(q.get("start_date")).toBe("13-10-2026");
    expect(q.get("end_date")).toBe("11-11-2026");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finishes a held draft that is published now, and leaves a still-scheduled one", async () => {
    const { http } = fakeServiceHttp(TRANSISTOR, [
      {
        url: `${API}/episodes/20`,
        json: {
          data: episode("20", "published", {
            published_at: "2026-11-10 12:00:00 UTC",
          }),
        },
      },
      {
        url: `${API}/episodes/21`,
        json: {
          data: episode("21", "scheduled", {
            published_at: "2026-11-15 12:00:00 UTC",
          }),
        },
      },
      ...routes(),
    ]);
    const out = await pullTransistor(
      ctx(http, {
        open: [
          {
            externalId: "episode:20",
            kind: "task",
            title: "Finish episode: A",
          },
          {
            externalId: "episode:21",
            kind: "task",
            title: "Finish episode: B",
          },
        ],
      })
    );
    const done = out.items.filter((i) => i.kind === "task");
    expect(done).toEqual([
      {
        kind: "task",
        externalId: "episode:20",
        title: "Finish episode: A",
        state: "done",
        doneAt: new Date("2026-11-10T12:00:00.000Z"),
      },
    ]);
  });

  it("asks for one show and reports partial when analytics fails", async () => {
    const { http, calls } = fakeServiceHttp(TRANSISTOR, [
      { url: `${API}/analytics/`, status: 500, text: "nope" },
      ...routes(),
    ]);
    const out = await pullTransistor(
      ctx(http, {}, { show: "the-caffeine-show" })
    );
    expect(out.complete).toBe(false);
    expect(out.readings).toEqual([]);
    const episodes = calls.find((c) => c.url.includes("/episodes?"))!;
    expect(new URL(episodes.url).searchParams.get("show_id")).toBe("132543");
  });
});
