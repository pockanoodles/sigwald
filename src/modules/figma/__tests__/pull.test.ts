import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { fileKey, verifyFigma } from "@/lib/connectors/figma/client";
import { FIGMA } from "@/lib/connectors/figma/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import figma from "@/modules/figma/manifest";
import { pullFigma } from "@/modules/figma/pull";

const API = "https://api.figma.com/v1";
const KEY = "AbCdEfGhIjKlMn";
const now = new Date("2026-11-11T15:00:00.000Z");

const me = { id: "100", handle: "Kai" };
const ana = { id: "200", handle: "Ana" };

const comment = (
  id: string,
  user: { id: string; handle: string },
  message: string,
  at: string,
  over: Record<string, unknown> = {}
) => ({ id, user, message, created_at: at, resolved_at: null, ...over });

const ctx = (
  http: PullContext["http"],
  stored: Record<string, unknown> = {},
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "figd_secrettokenvalue" },
  config: { userId: "100", handle: "Kai" },
  settings: resolveSettings(figma.connect!.settings, {
    files: [`https://www.figma.com/design/${KEY}/Checkout-flow?node-id=1-2`],
    ...stored,
  }),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const routes = (comments: unknown[]) => [
  {
    url: `${API}/files/${KEY}/meta`,
    json: { file: { name: "Checkout flow" } },
  },
  { url: `${API}/files/${KEY}/comments`, json: { comments } },
];

describe("fileKey", () => {
  it("reads keys out of file, design and board addresses", () => {
    expect(fileKey(`https://www.figma.com/file/${KEY}/Name`)).toBe(KEY);
    expect(fileKey(`https://www.figma.com/design/${KEY}/Name?x=1`)).toBe(KEY);
    expect(fileKey(`https://figma.com/board/${KEY}/Jam`)).toBe(KEY);
    expect(fileKey(KEY)).toBe(KEY);
    expect(fileKey("https://example.com/nope")).toBeNull();
  });
});

describe("verifyFigma", () => {
  it("sends the token in X-Figma-Token and keeps who you are", async () => {
    const { http, calls } = fakeServiceHttp(FIGMA, [
      { url: `${API}/me`, json: { ...me, email: "k@x.io", img_url: "" } },
    ]);
    await expect(
      verifyFigma({ http, secret: { token: "figd_x" }, config: {} })
    ).resolves.toEqual({
      label: "Kai",
      config: { userId: "100", handle: "Kai" },
    });
    expect(calls[0].headers["X-Figma-Token"]).toBe("figd_x");
  });
});

describe("pullFigma", () => {
  it("makes a task for an open thread someone else wrote last", async () => {
    const { http, calls } = fakeServiceHttp(
      FIGMA,
      routes([
        comment(
          "1",
          ana,
          "Can we make the button bigger on mobile?",
          "2026-11-10T10:00:00Z"
        ),
        comment("2", me, "Which size?", "2026-11-10T11:00:00Z", {
          parent_id: "1",
        }),
        comment("3", ana, "About 48px.", "2026-11-10T12:00:00Z", {
          parent_id: "1",
        }),
      ])
    );
    const result = await pullFigma(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "task",
      externalId: `${KEY}:1`,
      title: "Reply in Checkout flow: Can we make the button bigger on mobile?",
      state: "open",
      url: `https://www.figma.com/design/${KEY}`,
      group: { key: `figma:file:${KEY.toLowerCase()}`, label: "Checkout flow" },
    });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("cuts a long first comment to 80 characters", async () => {
    const { http } = fakeServiceHttp(
      FIGMA,
      routes([comment("1", ana, "x".repeat(200), "2026-11-10T10:00:00Z")])
    );
    const result = await pullFigma(ctx(http));
    expect(result.items[0].title).toBe(
      `Reply in Checkout flow: ${"x".repeat(79)}…`
    );
  });

  it("skips threads you started, resolved ones and ones you answered last", async () => {
    const { http } = fakeServiceHttp(
      FIGMA,
      routes([
        comment("1", me, "Mine", "2026-11-10T10:00:00Z"),
        comment("2", ana, "Resolved", "2026-11-10T10:00:00Z", {
          resolved_at: "2026-11-10T12:00:00Z",
        }),
        comment("3", ana, "Answered", "2026-11-10T10:00:00Z"),
        comment("4", me, "Done", "2026-11-10T11:00:00Z", { parent_id: "3" }),
      ])
    );
    const result = await pullFigma(ctx(http));
    expect(result.items).toEqual([]);
  });

  it("with the mentions toggle on, keeps only threads that name you", async () => {
    const { http } = fakeServiceHttp(
      FIGMA,
      routes([
        comment("1", ana, "Anyone?", "2026-11-10T10:00:00Z"),
        comment("2", ana, "@Kai can you check this", "2026-11-10T10:00:00Z"),
      ])
    );
    const result = await pullFigma(ctx(http, { mentionsOnly: true }));
    expect(result.items.map((i) => i.externalId)).toEqual([`${KEY}:2`]);
  });

  it("finishes a held thread once it is resolved or you replied last", async () => {
    const { http } = fakeServiceHttp(
      FIGMA,
      routes([
        comment("1", ana, "A", "2026-11-10T10:00:00Z", {
          resolved_at: "2026-11-11T09:00:00Z",
        }),
        comment("2", ana, "B", "2026-11-10T10:00:00Z"),
        comment("3", me, "Replied", "2026-11-11T08:00:00Z", { parent_id: "2" }),
      ])
    );
    const result = await pullFigma(
      ctx(
        http,
        {},
        {
          open: [
            { externalId: `${KEY}:1`, kind: "task", title: "Reply in X: A" },
            { externalId: `${KEY}:2`, kind: "task", title: "Reply in X: B" },
          ],
        }
      )
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: `${KEY}:1`,
        title: "Reply in X: A",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00Z"),
      },
      {
        kind: "task",
        externalId: `${KEY}:2`,
        title: "Reply in X: B",
        state: "done",
        doneAt: new Date("2026-11-11T08:00:00Z"),
      },
    ]);
  });

  it("says it is partial when a file could not be read", async () => {
    const { http } = fakeServiceHttp(FIGMA, [
      {
        url: `${API}/files/${KEY}/meta`,
        status: 404,
        json: { err: "Not found" },
      },
    ]);
    const result = await pullFigma(ctx(http));
    expect(result).toMatchObject({ items: [], complete: false });
  });
});
