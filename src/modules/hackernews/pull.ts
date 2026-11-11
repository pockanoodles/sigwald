/**
 * Hacker News' pull: Algolia's newest-first search for each watched word
 * within the days kept. Algolia forgives typos, so a hit counts only when
 * the word is really in its title, text or link.
 * Docs: https://hn.algolia.com/api (GET /api/v1/search_by_date)
 */
import {
  type PullFn,
  type PulledTask,
  fact,
  plainText,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

interface Hit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  author: string;
  created_at_i: number;
  points?: number | null;
  num_comments?: number | null;
  _tags?: string[];
}

export const pullHackernews: PullFn = async ({ http, settings, now }) => {
  const words = setting.list(settings, "words");
  const kinds = setting.text(settings, "kinds").split(",").filter(Boolean);
  const since =
    Math.floor(now.getTime() / 1000) -
    setting.number(settings, "days", 3) * 86_400;

  const items: PulledTask[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const res = await http.json<{ hits: Hit[]; nbHits?: number }>({
      url: "https://hn.algolia.com/api/v1/search_by_date",
      query: {
        query: word,
        tags: `(${kinds.join(",")})`,
        numericFilters: `created_at_i>${since}`,
        hitsPerPage: 50,
      },
    });
    const needle = word.toLowerCase();
    for (const h of res.hits) {
      if (seen.has(h.objectID)) continue;
      const isComment = h._tags?.includes("comment") ?? Boolean(h.comment_text);
      const text = plainText(h.comment_text ?? h.story_text ?? null, 1200);
      const haystack = [h.title, h.story_title, text, h.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) continue;
      seen.add(h.objectID);
      const story = h.title ?? h.story_title ?? "a story";
      items.push({
        kind: "task",
        externalId: h.objectID,
        title: isComment ? `HN comment on: ${story}` : `HN: ${story}`,
        state: "open",
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        description: text,
        group: { key: `hackernews:word:${needle}`, label: `HN: ${word}` },
        facts: [
          ...fact("By", h.author),
          ...fact("Points", h.points),
          ...fact("Comments", h.num_comments),
          ...fact("Link", h.url),
          ...fact(
            "When",
            new Date(h.created_at_i * 1000)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ")
          ),
        ],
        updatedAt: new Date(h.created_at_i * 1000),
      });
    }
  }
  return { items, complete: true };
};
