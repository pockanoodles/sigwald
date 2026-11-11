import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { FEDERAL_REGISTER } from "@/lib/connectors/fedreg/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import fedreg from "@/modules/fedreg/manifest";
import { pullFedreg } from "@/modules/fedreg/pull";

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(fedreg.connect!.settings, {
    terms: "privacy",
    ...settings,
  }),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

// Shaped as www.federalregister.gov answered on 2026-11-11.
const doc = {
  title: "Amendment of Jet Route J-21 in the Vicinity of Laredo, TX",
  type: "Proposed Rule",
  abstract: "<p>This action proposes to amend Jet Route J-21.</p>",
  comments_close_on: "2026-12-28",
  html_url:
    "https://www.federalregister.gov/documents/2026/11/12/2026-23017/amendment",
  document_number: "2026-23017",
  publication_date: "2026-11-12",
  agencies: [
    {
      raw_name: "DEPARTMENT OF TRANSPORTATION",
      name: "Transportation Department",
      id: 492,
      url: "https://www.federalregister.gov/agencies/transportation-department",
      slug: "transportation-department",
    },
  ],
};

describe("pullFedreg", () => {
  it("asks for documents still open for comment and makes tasks due when comments close", async () => {
    const { http, calls } = fakeServiceHttp(FEDERAL_REGISTER, [
      {
        url: "https://www.federalregister.gov/api/v1/documents.json",
        json: { count: 1, results: [doc] },
      },
    ]);
    const result = await pullFedreg(
      ctx(http, {
        agencies: ["transportation-department"],
        types: "PRORULE,NOTICE",
      })
    );
    const asked = new URL(calls[0].url).searchParams;
    expect(asked.get("conditions[term]")).toBe("privacy");
    expect(asked.get("conditions[comment_date][gte]")).toBe("2026-11-11");
    expect(asked.getAll("conditions[type][]")).toEqual(["PRORULE", "NOTICE"]);
    expect(asked.getAll("conditions[agencies][]")).toEqual([
      "transportation-department",
    ]);
    expect(result.items[0]).toMatchObject({
      externalId: "2026-23017",
      title:
        "Comment on: Amendment of Jet Route J-21 in the Vicinity of Laredo, TX",
      due: { date: "2026-12-28" },
      description: "This action proposes to amend Jet Route J-21.",
      group: {
        key: "fedreg:agency:transportation-department",
        label: "Transportation Department",
      },
    });
    expect(result.complete).toBe(true);
  });

  it("says the pull was partial when more matched than it read", async () => {
    const { http } = fakeServiceHttp(FEDERAL_REGISTER, [
      {
        url: "https://www.federalregister.gov/api/v1/documents.json",
        json: { count: 207, results: [doc] },
      },
    ]);
    expect((await pullFedreg(ctx(http, {}))).complete).toBe(false);
  });
});
