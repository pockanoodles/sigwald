/**
 * arXiv's pull: the newest 50 papers for the search, the ones submitted
 * within the days kept as reading tasks. arXiv asks for no more than one
 * request every three seconds; this makes one every six hours.
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 */
import { parseFeed } from "@/lib/connectors/web/feed";

import {
  type PullFn,
  type PulledTask,
  fact,
  plainText,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

/** "http://arxiv.org/abs/2611.14516v1" → "2611.14516": the paper, whatever its version. */
export function arxivId(entryId: string): string {
  const m = entryId.match(/abs\/([^v]+?)(v\d+)?$/);
  return m ? m[1] : entryId;
}

export const pullArxiv: PullFn = async ({ http, settings, now }) => {
  const query = setting.text(settings, "query");
  const days = setting.number(settings, "days", 4);
  const since = now.getTime() - days * 86_400_000;

  const feed = parseFeed(
    await http.text({
      url: "https://export.arxiv.org/api/query",
      query: {
        search_query: query,
        sortBy: "submittedDate",
        sortOrder: "descending",
        max_results: 50,
      },
    })
  );

  const items: PulledTask[] = [];
  for (const e of feed.entries) {
    if (!e.published || e.published.getTime() < since) continue;
    const id = arxivId(e.id);
    const authors =
      e.authors.length > 3
        ? `${e.authors.slice(0, 3).join(", ")} et al.`
        : e.authors.join(", ");
    const primary = e.categories[0] ?? null;
    items.push({
      kind: "task",
      externalId: id,
      title: `Read: ${e.title}`,
      state: "open",
      url: `https://arxiv.org/abs/${id}`,
      description: plainText(e.summary, 1500),
      group: primary
        ? {
            key: `arxiv:cat:${primary.toLowerCase()}`,
            label: `arXiv ${primary}`,
          }
        : null,
      facts: [
        ...fact("Authors", authors),
        ...fact("Submitted", e.published.toISOString().slice(0, 10)),
        ...fact("Categories", e.categories.join(", ")),
        ...fact("arXiv", id),
      ],
      updatedAt: e.published,
    });
  }
  // The window decides what's current: anything older has stepped aside.
  return { items, complete: true };
};
