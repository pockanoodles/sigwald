import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { ARXIV } from "@/lib/connectors/arxiv/service";

import arxiv from "@/modules/arxiv/manifest";
import { arxivId, pullArxiv } from "@/modules/arxiv/pull";
import type { PullContext, PulledTask } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

// Shaped as export.arxiv.org answered on 2026-11-11.
const atom = (entries: string) => `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/x</id><title>arXiv Query</title>
  <opensearch:totalResults>298685</opensearch:totalResults>
  ${entries}
</feed>`;
const entry = (id: string, published: string, authors: string[]) => `<entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <title>TorchCurves:
      Differentiable Parametric Curves</title>
    <updated>${published}</updated>
    <published>${published}</published>
    <link href="https://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/${id}v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>We present TorchCurves, a PyTorch library.</summary>
    ${authors.map((a) => `<author><name>${a}</name></author>`).join("")}
    <arxiv:primary_category term="cs.LG"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.MS" scheme="http://arxiv.org/schemas/atom"/>
  </entry>`;

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(arxiv.connect!.settings, {
    query: "cat:cs.LG",
    days: 4,
  }),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("pullArxiv", () => {
  it("makes reading tasks for the papers submitted within the days kept", async () => {
    const { http, calls } = fakeServiceHttp(ARXIV, [
      {
        url: "https://export.arxiv.org/api/query",
        text: atom(
          entry("2611.14516", "2026-11-10T18:58:52Z", [
            "A One",
            "B Two",
            "C Three",
            "D Four",
          ]) + entry("2610.00001", "2026-10-01T00:00:00Z", ["Old"])
        ),
        headers: { "content-type": "application/atom+xml" },
      },
    ]);
    const result = await pullArxiv(ctx(http));
    const asked = new URL(calls[0].url).searchParams;
    expect(asked.get("search_query")).toBe("cat:cs.LG");
    expect(asked.get("sortBy")).toBe("submittedDate");
    const tasks = result.items as PulledTask[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      externalId: "2611.14516",
      title: "Read: TorchCurves: Differentiable Parametric Curves",
      url: "https://arxiv.org/abs/2611.14516",
      description: "We present TorchCurves, a PyTorch library.",
      group: { key: "arxiv:cat:cs.lg", label: "arXiv cs.LG" },
    });
    expect(tasks[0].facts).toContainEqual({
      label: "Authors",
      value: "A One, B Two, C Three et al.",
    });
    expect(result.complete).toBe(true);
  });
});

describe("arxivId", () => {
  it("drops the version, so a revised paper stays the same task", () => {
    expect(arxivId("http://arxiv.org/abs/2611.14516v3")).toBe("2611.14516");
    expect(arxivId("http://arxiv.org/abs/hep-th/9901001v1")).toBe(
      "hep-th/9901001"
    );
  });
});

describe("a full page of new papers", () => {
  it("can't vouch for the window, so nothing ages out early", async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      entry(`2611.${String(10000 + i)}`, "2026-11-10T18:58:52Z", ["A"])
    ).join("");
    const { http } = fakeServiceHttp(ARXIV, [
      { url: "https://export.arxiv.org/api/query", text: atom(many) },
    ]);
    expect((await pullArxiv(ctx(http))).complete).toBe(false);
  });
});
