import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyYoutube } from "@/lib/connectors/youtube/client";
import { YOUTUBE } from "@/lib/connectors/youtube/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import youtube from "@/modules/youtube/manifest";
import { pullYoutube } from "@/modules/youtube/pull";

const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL = {
  id: "UCabcdefghijklmnopqrstuv",
  snippet: { title: "Kaito Makes" },
  statistics: {
    viewCount: "123456",
    subscriberCount: "4210",
    hiddenSubscriberCount: false,
    videoCount: "37",
  },
  contentDetails: { relatedPlaylists: { uploads: "UUabcdefghijklmnopqrstuv" } },
};

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: { key: "AIzaSyFAKEKEY0123456789" },
  config: { channel: "@kaito", channelId: CHANNEL.id },
  settings: resolveSettings(youtube.connect!.settings, {}),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const routes = (channel: unknown = CHANNEL) => [
  { url: `${API}/channels`, json: { items: [channel] } },
  {
    url: `${API}/playlistItems`,
    json: { items: [{ contentDetails: { videoId: "vid1" } }] },
  },
  {
    url: `${API}/videos`,
    json: {
      items: [
        { snippet: { title: "Latest" }, statistics: { viewCount: "999" } },
      ],
    },
  },
];

describe("verifyYoutube", () => {
  it("looks a handle up and keeps the channel id", async () => {
    const { http, calls } = fakeServiceHttp(YOUTUBE, routes());
    const out = await verifyYoutube({
      http,
      secret: { key: "AIzaSyFAKEKEY0123456789" },
      config: { channel: "@kaito" },
    });
    expect(out.label).toBe("Kaito Makes");
    expect(out.config?.channelId).toBe(CHANNEL.id);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("forHandle")).toBe("@kaito");
    expect(url.searchParams.get("part")).toBe("snippet,contentDetails");
    expect(calls[0].headers["X-Goog-Api-Key"]).toBe("AIzaSyFAKEKEY0123456789");
    expect(url.searchParams.has("key")).toBe(false);
  });

  it("looks a channel id up by id", async () => {
    const { http, calls } = fakeServiceHttp(YOUTUBE, routes());
    await verifyYoutube({
      http,
      secret: { key: "k" },
      config: { channel: CHANNEL.id },
    });
    expect(new URL(calls[0].url).searchParams.get("id")).toBe(CHANNEL.id);
  });

  it("fails when there is no such channel", async () => {
    const { http } = fakeServiceHttp(YOUTUBE, [
      { url: `${API}/channels`, json: {} },
    ]);
    await expect(
      verifyYoutube({ http, secret: { key: "k" }, config: { channel: "@no" } })
    ).rejects.toThrow(/no channel/);
  });
});

describe("pullYoutube", () => {
  it("reads the counts and the newest upload, with GETs only", async () => {
    const { http, calls } = fakeServiceHttp(YOUTUBE, routes());
    const out = await pullYoutube(ctx(http));
    expect(out.complete).toBe(true);
    expect(out.items).toEqual([]);
    expect(out.readings).toEqual([
      { key: "subscribers", label: "Subscribers", value: 4210, unit: "count" },
      { key: "views", label: "Total views", value: 123456, unit: "count" },
      { key: "videos", label: "Videos", value: 37, unit: "count" },
      {
        key: "latest_views",
        label: "Newest upload views",
        value: 999,
        unit: "count",
      },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(new URL(calls[1].url).searchParams.get("playlistId")).toBe(
      "UUabcdefghijklmnopqrstuv"
    );
  });

  it("leaves out hidden subscribers", async () => {
    const { http } = fakeServiceHttp(
      YOUTUBE,
      routes({
        ...CHANNEL,
        statistics: { ...CHANNEL.statistics, hiddenSubscriberCount: true },
      })
    );
    const out = await pullYoutube(ctx(http));
    expect(out.readings?.map((r) => r.key)).not.toContain("subscribers");
  });

  it("is incomplete when the newest upload can't be read", async () => {
    const { http } = fakeServiceHttp(YOUTUBE, [
      { url: `${API}/channels`, json: { items: [CHANNEL] } },
      { url: `${API}/playlistItems`, status: 500, text: "boom" },
    ]);
    const out = await pullYoutube(ctx(http));
    expect(out.complete).toBe(false);
    expect(out.readings?.map((r) => r.key)).toContain("views");
  });
});
