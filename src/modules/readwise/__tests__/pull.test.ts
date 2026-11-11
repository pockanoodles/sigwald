import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyReadwise } from "@/lib/connectors/readwise/client";
import { READWISE } from "@/lib/connectors/readwise/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import readwise from "@/modules/readwise/manifest";
import { minutesOf, pullReadwise } from "@/modules/readwise/pull";

const LIST = "https://readwise.io/api/v3/list/";
const now = new Date("2026-11-11T15:00:00.000Z");

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "rw-token-abcdefgh" },
  config: {},
  settings: resolveSettings(readwise.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const doc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://readwise.io/reader/document/${id}`,
  source_url: `https://example.org/${id}`,
  title: `Article ${id}`,
  author: "Jane Writer",
  site_name: "Example",
  category: "article",
  location: "later",
  word_count: 2400,
  reading_time: "10 mins",
  updated_at: "2026-11-10T10:00:00.000Z",
  parent_id: null,
  ...over,
});

const at = (location: string) =>
  new RegExp(`${LIST.replace(/[/.]/g, "\\$&")}\\?.*location=${location}`);

describe("verifyReadwise", () => {
  it("accepts the empty answer of the auth check (the fake cannot send a bodiless 204), sending a Token header", async () => {
    const { http, calls } = fakeServiceHttp(READWISE, [
      { url: "https://readwise.io/api/v2/auth/", status: 200, text: "" },
    ]);
    await expect(
      verifyReadwise({ http, secret: { token: "t" }, config: {} })
    ).resolves.toEqual({ label: "Readwise Reader" });
    expect(calls[0].headers.Authorization).toBe("Token t");
  });
});

describe("minutesOf", () => {
  it("reads the text, then the word count", () => {
    expect(minutesOf({ id: "1", reading_time: "4 mins" })).toBe(4);
    expect(minutesOf({ id: "1", reading_time: null, word_count: 476 })).toBe(2);
    expect(minutesOf({ id: "1" })).toBeNull();
  });
});

describe("pullReadwise", () => {
  it("makes Read tasks from Later and Shortlist, and counts Later", async () => {
    const { http, calls } = fakeServiceHttp(READWISE, [
      {
        url: at("later"),
        json: {
          count: 42,
          nextPageCursor: null,
          results: [
            doc("a1"),
            doc("h1", { category: "highlight", parent_id: "a1" }),
          ],
        },
      },
      {
        url: at("shortlist"),
        json: {
          count: 1,
          nextPageCursor: null,
          results: [doc("s1", { location: "shortlist", reading_time: null })],
        },
      },
    ]);
    const out = await pullReadwise(ctx(http));
    expect(out.complete).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      externalId: "a1",
      title: "Read: Article a1",
      url: "https://example.org/a1",
      minutes: 10,
      group: { key: "readwise:location:later", label: "Reader: Later" },
    });
    expect(out.items[1]).toMatchObject({ externalId: "s1", minutes: 11 });
    expect(out.readings).toEqual([
      { key: "later", label: "Waiting in Later", value: 42, unit: "count" },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("follows the cursor and is partial past the page cap", async () => {
    const { http } = fakeServiceHttp(READWISE, [
      {
        url: at("later"),
        json: { count: 900, nextPageCursor: "next", results: [doc("a1")] },
      },
      { url: at("shortlist"), json: { count: 0, results: [] } },
    ]);
    const out = await pullReadwise(ctx(http));
    expect(out.complete).toBe(false);
  });

  it("finishes held documents that were archived since the last pull", async () => {
    const { http, calls } = fakeServiceHttp(READWISE, [
      { url: at("later"), json: { count: 0, results: [] } },
      { url: at("shortlist"), json: { count: 0, results: [] } },
      {
        url: at("archive"),
        json: {
          count: 2,
          results: [
            doc("a9", {
              location: "archive",
              updated_at: "2026-11-11T09:00:00Z",
            }),
            doc("zz", { location: "archive" }),
          ],
        },
      },
    ]);
    const out = await pullReadwise(
      ctx(http, {
        lastSuccessAt: new Date("2026-11-10T00:00:00.000Z"),
        open: [{ externalId: "a9", kind: "task", title: "Read: Nine" }],
      })
    );
    expect(out.items).toEqual([
      {
        kind: "task",
        externalId: "a9",
        title: "Read: Nine",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00Z"),
      },
    ]);
    const archive = calls.find((c) => c.url.includes("location=archive"))!;
    expect(new URL(archive.url).searchParams.get("updatedAfter")).toBe(
      "2026-11-10T00:00:00.000Z"
    );
  });
});
