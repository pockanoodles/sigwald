import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { HACKER_NEWS } from "@/lib/connectors/hackernews/service";

import type { PullContext, PulledTask } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import hackernews from "@/modules/hackernews/manifest";
import { pullHackernews } from "@/modules/hackernews/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(hackernews.connect!.settings, settings),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const t = Math.floor(now.getTime() / 1000) - 3600;

// Shaped as hn.algolia.com answers search_by_date.
const hits = {
  hits: [
    {
      objectID: "41001",
      title: "Show HN: Sigwald, a calendar that ranks your work",
      url: "https://sigwald.app",
      author: "kai",
      created_at_i: t,
      points: 120,
      num_comments: 40,
      _tags: ["story", "author_kai", "story_41001"],
    },
    {
      objectID: "41002",
      story_title: "Ask HN: Planning tools?",
      comment_text: "I switched to <i>Sigwald</i> last month.",
      author: "pat",
      created_at_i: t,
      _tags: ["comment", "author_pat"],
    },
    // Algolia forgives typos: this one only looks like a match.
    {
      objectID: "41003",
      story_title: "Thermodynamics of trading",
      comment_text: "Ron Sigwalt explores data centres.",
      author: "x",
      created_at_i: t,
      _tags: ["comment"],
    },
  ],
};

describe("pullHackernews", () => {
  it("makes a task per real mention, story or comment, within the days kept", async () => {
    const { http, calls } = fakeServiceHttp(HACKER_NEWS, [
      { url: "https://hn.algolia.com/api/v1/search_by_date", json: hits },
    ]);
    const result = await pullHackernews(
      ctx(http, { words: ["Sigwald"], days: 2 })
    );
    const asked = new URL(calls[0].url).searchParams;
    expect(asked.get("tags")).toBe("(story,comment)");
    expect(asked.get("numericFilters")).toBe(
      `created_at_i>${Math.floor(now.getTime() / 1000) - 2 * 86_400}`
    );
    const tasks = result.items as PulledTask[];
    expect(tasks.map((x) => x.title)).toEqual([
      "HN: Show HN: Sigwald, a calendar that ranks your work",
      "HN comment on: Ask HN: Planning tools?",
    ]);
    expect(tasks[1]).toMatchObject({
      url: "https://news.ycombinator.com/item?id=41002",
      description: "I switched to Sigwald last month.",
      group: { key: "hackernews:word:sigwald", label: "HN: Sigwald" },
    });
  });
});
