/**
 * Semantic Scholar's pull: one author read, three numbers.
 * Docs: https://api.semanticscholar.org/api-docs/graph#tag/Author-Data/operation/get_graph_get_author
 */
import { ConnectorError, isConnectorError } from "@/lib/connectors/errors";

import type { PullFn } from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

interface Author {
  authorId: string;
  name: string;
  citationCount: number | null;
  hIndex: number | null;
  paperCount: number | null;
}

export const pullScholar: PullFn = async ({ http, settings }) => {
  const id = setting.text(settings, "author");
  let author: Author;
  try {
    author = await http.json<Author>({
      url: `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(id)}`,
      query: { fields: "name,citationCount,hIndex,paperCount" },
    });
  } catch (error) {
    if (isConnectorError(error) && error.kind === "not_found") {
      throw new ConnectorError(
        "config",
        `Semantic Scholar has no author ${id}.`
      );
    }
    throw error;
  }
  const readings = [
    { key: "citations", label: "Citations", value: author.citationCount },
    { key: "hindex", label: "h-index", value: author.hIndex },
    { key: "papers", label: "Papers", value: author.paperCount },
  ].flatMap((r) =>
    typeof r.value === "number" ? [{ ...r, value: r.value, unit: "count" }] : []
  );
  return { items: [], complete: true, readings };
};
