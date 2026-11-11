import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { SEMANTIC_SCHOLAR } from "@/lib/connectors/semanticscholar/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import scholar from "@/modules/scholar/manifest";
import { pullScholar } from "@/modules/scholar/pull";

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(scholar.connect!.settings, { author: "1741101" }),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("pullScholar", () => {
  it("reads an author's citations, h-index and papers", async () => {
    const { http, calls } = fakeServiceHttp(SEMANTIC_SCHOLAR, [
      {
        url: "https://api.semanticscholar.org/graph/v1/author/1741101",
        // As api.semanticscholar.org answered on 2026-11-11.
        json: {
          authorId: "1741101",
          name: "Oren Etzioni",
          paperCount: 262,
          citationCount: 46076,
          hIndex: 88,
        },
      },
    ]);
    const result = await pullScholar(ctx(http));
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe(
      "name,citationCount,hIndex,paperCount"
    );
    expect(result.readings).toEqual([
      { key: "citations", label: "Citations", value: 46076, unit: "count" },
      { key: "hindex", label: "h-index", value: 88, unit: "count" },
      { key: "papers", label: "Papers", value: 262, unit: "count" },
    ]);
  });

  it("says plainly when the author id isn't one", async () => {
    const { http } = fakeServiceHttp(SEMANTIC_SCHOLAR, [
      { url: /author/, status: 404, json: { error: "Author not found" } },
    ]);
    await expect(pullScholar(ctx(http))).rejects.toMatchObject({
      kind: "config",
    });
  });
});
