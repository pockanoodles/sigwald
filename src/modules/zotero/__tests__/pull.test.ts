import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyZotero } from "@/lib/connectors/zotero/client";
import { ZOTERO } from "@/lib/connectors/zotero/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import zotero from "@/modules/zotero/manifest";
import { authors, pullZotero } from "@/modules/zotero/pull";

const API = "https://api.zotero.org";
const now = new Date("2026-11-11T15:00:00.000Z");

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {},
  settings: Record<string, unknown> = {}
): PullContext => ({
  http,
  secret: { key: "zotero-key-abcdefgh" },
  config: { userID: "123", username: "kaito" },
  settings: resolveSettings(zotero.connect!.settings, settings),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const item = (key: string, data: Record<string, unknown> = {}) => ({
  key,
  version: 5,
  links: { alternate: { href: `https://www.zotero.org/kaito/items/${key}` } },
  meta: { parsedDate: "2021-06-01" },
  data: {
    key,
    itemType: "journalArticle",
    title: `Paper ${key}`,
    creators: [
      { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
      { creatorType: "author", firstName: "Alan", lastName: "Turing" },
      { creatorType: "author", firstName: "Grace", lastName: "Hopper" },
    ],
    date: "June 2021",
    publicationTitle: "Journal of Things",
    tags: [{ tag: "to-read" }],
    dateModified: "2026-11-10T09:00:00Z",
    ...data,
  },
});

describe("verifyZotero", () => {
  it("reads the key's user, sending the version header", async () => {
    const { http, calls } = fakeServiceHttp(ZOTERO, [
      {
        url: `${API}/keys/current`,
        json: { key: "k", userID: 123, username: "kaito", access: {} },
      },
    ]);
    await expect(
      verifyZotero({ http, secret: { key: "k" }, config: {} })
    ).resolves.toEqual({
      label: "kaito",
      config: { userID: "123", username: "kaito" },
    });
    expect(calls[0].headers["Zotero-API-Key"]).toBe("k");
    expect(calls[0].headers["Zotero-API-Version"]).toBe("3");
  });
});

describe("authors", () => {
  it("names one, two or many", () => {
    expect(authors([{ lastName: "A" }])).toBe("A");
    expect(authors([{ lastName: "A" }, { name: "B Corp" }])).toBe(
      "A and B Corp"
    );
    expect(
      authors([{ lastName: "A" }, { lastName: "B" }, { lastName: "C" }])
    ).toBe("A et al.");
    expect(authors([])).toBe("");
  });
});

describe("pullZotero", () => {
  it("makes Read tasks for tagged top-level items, with facts and links", async () => {
    const { http, calls } = fakeServiceHttp(ZOTERO, [
      {
        url: `${API}/users/123/items/top`,
        json: [
          item("AAAA1111", { url: "https://example.org/paper" }),
          item("BBBB2222", { DOI: "10.1000/xyz" }),
          item("CCCC3333"),
          item("NOTE0001", { itemType: "note" }),
        ],
      },
    ]);
    const out = await pullZotero(ctx(http));
    expect(out.complete).toBe(true);
    expect(out.items).toHaveLength(3);
    expect(out.items[0]).toMatchObject({
      externalId: "AAAA1111",
      title: "Read: Paper AAAA1111",
      state: "open",
      url: "https://example.org/paper",
      group: { key: "zotero:tag:to-read", label: "to-read" },
      facts: [
        { label: "Authors", value: "Lovelace et al." },
        { label: "Year", value: "2021" },
        { label: "Publication", value: "Journal of Things" },
      ],
    });
    expect((out.items[1] as { url: string }).url).toBe(
      "https://doi.org/10.1000/xyz"
    );
    expect((out.items[2] as { url: string }).url).toBe(
      "https://www.zotero.org/kaito/items/CCCC3333"
    );
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("tag")).toBe("to-read");
    expect(q.get("format")).toBe("json");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("follows the Link header and is partial after three pages", async () => {
    const link = `<${API}/users/123/items/top?start=100>; rel="next"`;
    const { http } = fakeServiceHttp(ZOTERO, [
      {
        url: `${API}/users/123/items/top`,
        json: [item("AAAA1111")],
        headers: { "content-type": "application/json", link },
      },
    ]);
    const out = await pullZotero(ctx(http));
    expect(out.complete).toBe(false);
    expect(out.items).toHaveLength(1);
  });

  it("finishes held items that lost the tag and ignores deleted ones", async () => {
    const { http, calls } = fakeServiceHttp(ZOTERO, [
      { url: `${API}/users/123/items/top`, json: [] },
      {
        url: `${API}/users/123/items?`,
        json: [
          item("READ0001", { tags: [{ tag: "done" }] }),
          item("STAY0002", { tags: [{ tag: "To-Read" }] }),
        ],
      },
    ]);
    const out = await pullZotero(
      ctx(http, {
        open: [
          { externalId: "READ0001", kind: "task", title: "Read: Old" },
          { externalId: "STAY0002", kind: "task", title: "Read: Stay" },
          { externalId: "GONE0003", kind: "task", title: "Read: Gone" },
        ],
      })
    );
    expect(out.items).toEqual([
      {
        kind: "task",
        externalId: "READ0001",
        title: "Read: Old",
        state: "done",
        doneAt: new Date("2026-11-10T09:00:00Z"),
      },
    ]);
    expect(out.complete).toBe(true);
    const keys = new URL(calls[1].url).searchParams.get("itemKey");
    expect(keys).toBe("READ0001,STAY0002,GONE0003");
  });

  it("reads a collection instead of the tag when one is set", async () => {
    const { http, calls } = fakeServiceHttp(ZOTERO, [
      {
        url: `${API}/users/123/collections/ABCD2345/items/top`,
        json: [item("AAAA1111")],
      },
    ]);
    await pullZotero(ctx(http, {}, { collection: "ABCD2345" }));
    expect(new URL(calls[0].url).searchParams.has("tag")).toBe(false);
  });
});
