import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyWordpress } from "@/lib/connectors/wordpress/client";
import { WORDPRESS } from "@/lib/connectors/wordpress/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import wordpress from "@/modules/wordpress/manifest";
import { pullWordpress } from "@/modules/wordpress/pull";

const SITE = "https://blog.example.com/news";
const API = `${SITE}/wp-json/wp/v2`;
const now = new Date("2026-11-11T15:00:00.000Z");
const PASSWORD = "abcd efgh ijkl mnop qrst uvwx";

const post = (
  id: number,
  status: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  status,
  date_gmt: "2026-11-10T10:00:00",
  modified_gmt: "2026-11-10T11:00:00",
  link: `${SITE}/?p=${id}`,
  title: { raw: `Post ${id}`, rendered: `Post ${id}` },
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { appPassword: PASSWORD },
  config: { site: SITE, username: "kai", userId: "7" },
  settings: resolveSettings(wordpress.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyWordpress", () => {
  it("signs in with Basic auth and keeps your user id", async () => {
    const { http, calls } = fakeServiceHttp(
      WORDPRESS,
      [
        {
          url: `${API}/users/me`,
          json: { id: 7, name: "Kai S", username: "kai" },
        },
      ],
      { site: SITE }
    );
    await expect(
      verifyWordpress({
        http,
        secret: { appPassword: PASSWORD },
        config: { site: SITE, username: "kai" },
      })
    ).resolves.toEqual({ label: "Kai S", config: { userId: "7" } });
    expect(calls[0].url).toContain("context=edit");
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from(`kai:${PASSWORD}`).toString("base64")}`
    );
  });
});

describe("pullWordpress", () => {
  it("makes Finish and Review tasks and events of scheduled posts", async () => {
    const { http, calls } = fakeServiceHttp(
      WORDPRESS,
      [
        {
          url: `${API}/posts`,
          json: [
            post(1, "draft"),
            post(2, "pending"),
            post(3, "future", { date_gmt: "2026-11-12T14:00:00" }),
          ],
          headers: { "x-wp-totalpages": "1" },
        },
      ],
      { site: SITE }
    );
    const result = await pullWordpress(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items).toMatchObject([
      {
        kind: "task",
        externalId: "1",
        title: "Finish: Post 1",
        url: `${SITE}/wp-admin/post.php?post=1&action=edit`,
        group: { key: "wordpress:site:blog.example.com" },
      },
      { kind: "task", externalId: "2", title: "Review: Post 2" },
      {
        kind: "event",
        externalId: "scheduled:3",
        title: "Publishes: Post 3",
        busy: false,
        start: new Date("2026-11-12T14:00:00.000Z"),
        end: new Date("2026-11-12T14:15:00.000Z"),
      },
    ]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("author")).toBe("7");
    expect(url.searchParams.get("status")).toBe("draft,pending,future");
    expect(url.searchParams.get("context")).toBe("edit");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("finishes a held draft that is published now", async () => {
    const { http } = fakeServiceHttp(
      WORDPRESS,
      [
        {
          url: new RegExp(`${API}/posts\\?.*status=draft`),
          json: [],
          headers: { "x-wp-totalpages": "1" },
        },
        {
          url: new RegExp(`${API}/posts\\?.*status=publish`),
          json: [post(9, "publish", { date_gmt: "2026-11-11T09:00:00" })],
          headers: { "x-wp-totalpages": "1" },
        },
      ],
      { site: SITE }
    );
    const result = await pullWordpress(
      ctx(http, {
        open: [{ externalId: "9", kind: "task", title: "Finish: Old" }],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "9",
        title: "Finish: Old",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00.000Z"),
      },
    ]);
  });

  it("says it is partial when there is more than one page", async () => {
    const { http } = fakeServiceHttp(
      WORDPRESS,
      [
        {
          url: `${API}/posts`,
          json: [post(1, "draft")],
          headers: { "x-wp-totalpages": "3" },
        },
      ],
      { site: SITE }
    );
    expect((await pullWordpress(ctx(http))).complete).toBe(false);
  });
});
