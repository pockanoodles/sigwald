import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { WEB } from "@/lib/connectors/web/service";

import type { PullContext, PulledTask } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import feeds from "@/modules/feeds/manifest";
import { pullFeeds } from "@/modules/feeds/pull";

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Release notes</title>
  <item><title>v2.0 is out</title><link>https://example.com/v2</link><guid>rel-200</guid>
    <pubDate>Tue, 10 Nov 2026 18:00:00 GMT</pubDate><description>&lt;p&gt;Big release&lt;/p&gt;</description></item>
  <item><title>v1.9</title><link>https://example.com/v19</link><guid>rel-190</guid>
    <pubDate>Mon, 12 Oct 2026 18:00:00 GMT</pubDate></item>
  <item><title>Undated note</title><link>https://example.com/n</link></item>
</channel></rss>`;

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(feeds.connect!.settings, settings),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("pullFeeds", () => {
  it("makes a task per post in the window, keyed by the feed's own id", async () => {
    const { http } = fakeServiceHttp(WEB, [
      { url: "https://example.com/feed.xml", text: rss },
    ]);
    const result = await pullFeeds(
      ctx(http, { feeds: ["https://example.com/feed.xml"] })
    );
    const tasks = result.items as PulledTask[];
    expect(tasks.map((t) => t.title)).toEqual(["v2.0 is out"]);
    expect(tasks[0]).toMatchObject({
      url: "https://example.com/v2",
      description: "Big release",
      group: { label: "Release notes" },
    });
    const again = await pullFeeds(
      ctx(http, { feeds: ["https://example.com/feed.xml"] })
    );
    expect(again.items[0].externalId).toBe(tasks[0].externalId);
  });

  it("keeps a working feed's posts when another fails, and says the pull was partial", async () => {
    const { http } = fakeServiceHttp(WEB, [
      { url: "https://example.com/feed.xml", text: rss },
      { url: "https://broken.example.com/rss", text: "<html>nope</html>" },
    ]);
    const result = await pullFeeds(
      ctx(http, {
        feeds: [
          "https://example.com/feed.xml",
          "https://broken.example.com/rss",
        ],
        days: 60,
      })
    );
    expect(result.items.map((i) => i.title)).toEqual(["v2.0 is out", "v1.9"]);
    expect(result.complete).toBe(false);
  });
});
