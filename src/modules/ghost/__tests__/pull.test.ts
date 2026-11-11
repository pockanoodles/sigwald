import { createHmac } from "node:crypto";

import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { signAdminToken, verifyGhost } from "@/lib/connectors/ghost/client";
import { GHOST } from "@/lib/connectors/ghost/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import ghost from "@/modules/ghost/manifest";
import { pullGhost } from "@/modules/ghost/pull";

const SITE = "https://blog.example.com";
const API = `${SITE}/ghost/api/admin`;
const ID = "5f1a2b3c4d5e6f7a8b9c0d1e";
const SECRET =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const KEY = `${ID}:${SECRET}`;
const now = new Date("2026-11-11T15:00:00.000Z");

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { adminKey: KEY },
  config: { site: SITE, title: "The Blog" },
  settings: resolveSettings(ghost.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("signAdminToken", () => {
  it("signs an HS256 token Ghost accepts: kid, audience, short life, hex-decoded secret", () => {
    const token = signAdminToken(KEY, 1_800_000_000_000);
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "HS256",
      kid: ID,
      typ: "JWT",
    });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({
      iat: 1_800_000_000,
      exp: 1_800_000_240,
      aud: "/admin/",
    });
    const expected = createHmac("sha256", Buffer.from(SECRET, "hex"))
      .update(`${h}.${p}`)
      .digest("base64url");
    expect(s).toBe(expected);
  });

  it("refuses a key that isn't id:secret", () => {
    expect(() => signAdminToken("nope", 0)).toThrow(/id:secret/);
  });
});

describe("verifyGhost", () => {
  it("names the site and proves the key with a signed read", async () => {
    const { http, calls } = fakeServiceHttp(
      GHOST,
      [
        {
          url: `${API}/site/`,
          json: { site: { title: "The Blog", url: SITE } },
        },
        { url: `${API}/posts/`, json: { posts: [] } },
      ],
      { site: SITE }
    );
    await expect(
      verifyGhost({ http, secret: { adminKey: KEY }, config: { site: SITE } })
    ).resolves.toEqual({ label: "The Blog", config: { title: "The Blog" } });
    expect(calls[1].headers.Authorization).toMatch(
      /^Ghost [\w-]+\.[\w-]+\.[\w-]+$/
    );
    expect(calls[1].headers["Accept-Version"]).toMatch(/^v\d+\.\d+$/);
  });
});

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Post ${id}`,
  status: "draft",
  updated_at: "2026-11-10T10:00:00.000Z",
  published_at: null,
  ...over,
});

const members = { meta: { pagination: { total: 1234, next: null } } };

describe("pullGhost", () => {
  it("makes tasks of drafts, events of scheduled posts and a reading of members", async () => {
    const { http, calls } = fakeServiceHttp(
      GHOST,
      [
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Adraft`),
          json: { posts: [post("d1")], meta: { pagination: { next: null } } },
        },
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Ascheduled`),
          json: {
            posts: [
              post("s1", {
                status: "scheduled",
                published_at: "2026-11-12T14:00:00.000Z",
              }),
            ],
            meta: { pagination: { next: null } },
          },
        },
        { url: `${API}/members/`, json: members },
      ],
      { site: SITE }
    );
    const result = await pullGhost(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      kind: "task",
      externalId: "d1",
      title: "Finish: Post d1",
      url: `${SITE}/ghost/#/editor/post/d1`,
      group: { key: "ghost:site:blog.example.com", label: "The Blog" },
    });
    expect(result.items[1]).toMatchObject({
      kind: "event",
      externalId: "scheduled:s1",
      title: "Publishes: Post s1",
      busy: false,
      start: new Date("2026-11-12T14:00:00.000Z"),
      end: new Date("2026-11-12T14:15:00.000Z"),
    });
    expect(result.readings).toEqual([
      { key: "members", label: "Members", value: 1234, unit: "count" },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.find((c) => c.url.includes("/members/"))?.url).toContain(
      "limit=1"
    );
  });

  it("finishes a held draft that has been published", async () => {
    const { http } = fakeServiceHttp(
      GHOST,
      [
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Adraft`),
          json: { posts: [], meta: { pagination: { next: null } } },
        },
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Ascheduled`),
          json: { posts: [], meta: { pagination: { next: null } } },
        },
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Apublished`),
          json: {
            posts: [
              post("d9", {
                status: "published",
                published_at: "2026-11-11T09:00:00.000Z",
              }),
            ],
          },
        },
        { url: `${API}/members/`, status: 403, json: { errors: [] } },
      ],
      { site: SITE }
    );
    const result = await pullGhost(
      ctx(http, {
        open: [{ externalId: "d9", kind: "task", title: "Finish: Old" }],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "d9",
        title: "Finish: Old",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00.000Z"),
      },
    ]);
    // No member access: no reading, but the rest still comes through.
    expect(result.readings).toEqual([]);
  });

  it("says it is partial when there are more drafts than one page", async () => {
    const { http } = fakeServiceHttp(
      GHOST,
      [
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Adraft`),
          json: { posts: [post("d1")], meta: { pagination: { next: 2 } } },
        },
        {
          url: new RegExp(`${API}/posts/\\?.*status%3Ascheduled`),
          json: { posts: [], meta: { pagination: { next: null } } },
        },
        { url: `${API}/members/`, json: members },
      ],
      { site: SITE }
    );
    expect((await pullGhost(ctx(http))).complete).toBe(false);
  });
});
