import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyZendesk } from "@/lib/connectors/zendesk/client";
import { ZENDESK } from "@/lib/connectors/zendesk/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import zendesk from "@/modules/zendesk/manifest";
import { impactOfPriority, pullZendesk } from "@/modules/zendesk/pull";

const SITE = "https://acme.zendesk.com";
const config = { site: SITE, email: "kai@acme.com" };
const now = new Date("2026-11-11T15:00:00.000Z");

const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  subject: `Ticket ${id}`,
  priority: "high",
  status: "open",
  type: "incident",
  due_at: null,
  updated_at: "2026-11-11T10:00:00Z",
  requester_id: 99,
  description: "Hi, reach me at someone@example.com",
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "abcdefghijklmnopqrstuvwxyz0123" },
  config: { ...config, userId: "12" },
  settings: resolveSettings(zendesk.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyZendesk", () => {
  it("signs in as email/token and names the agent", async () => {
    const { http, calls } = fakeServiceHttp(
      ZENDESK,
      [
        {
          url: `${SITE}/api/v2/users/me`,
          json: { user: { id: 12, name: "Kai Soeno", role: "agent" } },
        },
      ],
      config
    );
    await expect(
      verifyZendesk({ http, secret: { token: "tok123" }, config })
    ).resolves.toEqual({ label: "Kai Soeno", config: { userId: "12" } });
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("kai@acme.com/token:tok123").toString("base64")}`
    );
  });

  it("refuses an end user", async () => {
    const { http } = fakeServiceHttp(
      ZENDESK,
      [
        {
          url: `${SITE}/api/v2/users/me`,
          json: { user: { id: 1, name: "Anon", role: "end-user" } },
        },
      ],
      config
    );
    await expect(
      verifyZendesk({ http, secret: { token: "t" }, config })
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("won't send to a host outside zendesk.com", async () => {
    const other = { ...config, site: "https://evil.example.com" };
    const { http } = fakeServiceHttp(ZENDESK, [], other);
    await expect(
      verifyZendesk({ http, secret: { token: "t" }, config: other })
    ).rejects.toMatchObject({ kind: "refused" });
  });
});

describe("pullZendesk", () => {
  it("makes a task per unsolved ticket, weighted by priority, linked, with no text kept", async () => {
    const { http, calls } = fakeServiceHttp(
      ZENDESK,
      [
        {
          url: `${SITE}/api/v2/search`,
          json: {
            results: [
              ticket(1),
              ticket(2, {
                priority: "urgent",
                type: "task",
                due_at: "2026-11-13T17:00:00Z",
              }),
              ticket(3, { priority: null, subject: null }),
            ],
            next_page: null,
            count: 3,
          },
        },
      ],
      config
    );
    const result = await pullZendesk(ctx(http));
    expect(result.complete).toBe(true);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("query")).toBe("type:ticket assignee:me status<solved");
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "#1 Ticket 1",
      impact: 0.7,
      url: `${SITE}/agent/tickets/1`,
      due: null,
    });
    expect(result.items[1]).toMatchObject({
      impact: 0.9,
      due: { at: new Date("2026-11-13T17:00:00.000Z") },
    });
    expect(result.items[2]).toMatchObject({
      title: "#3 (no subject)",
      impact: null,
    });
    expect(JSON.stringify(result)).not.toContain("@");
  });

  it("reports held tickets that are solved or closed now as done", async () => {
    const { http, calls } = fakeServiceHttp(
      ZENDESK,
      [
        {
          url: `${SITE}/api/v2/search`,
          json: { results: [ticket(1)], next_page: null },
        },
        {
          url: `${SITE}/api/v2/tickets/show_many`,
          json: {
            tickets: [
              ticket(9, {
                status: "solved",
                updated_at: "2026-11-11T12:00:00Z",
              }),
              ticket(8, { status: "open" }),
            ],
          },
        },
      ],
      config
    );
    const result = await pullZendesk(
      ctx(http, {
        open: [
          { externalId: "1", kind: "task", title: "#1 Ticket 1" },
          { externalId: "9", kind: "task", title: "#9 Held" },
          { externalId: "8", kind: "task", title: "#8 Reassigned" },
        ],
      })
    );
    expect(result.items).toContainEqual({
      kind: "task",
      externalId: "9",
      title: "#9 Held",
      state: "done",
      doneAt: new Date("2026-11-11T12:00:00.000Z"),
    });
    expect(result.items.some((i) => i.externalId === "8")).toBe(false);
    expect(calls[1].url).toContain("ids=9%2C8");
  });

  it("says the answer is partial past its page cap", async () => {
    const { http } = fakeServiceHttp(
      ZENDESK,
      [
        {
          url: `${SITE}/api/v2/search`,
          json: {
            results: [ticket(1)],
            next_page: `${SITE}/api/v2/search?page=2`,
          },
        },
      ],
      config
    );
    expect((await pullZendesk(ctx(http))).complete).toBe(false);
  });

  it("only reads", async () => {
    const { http, calls } = fakeServiceHttp(
      ZENDESK,
      [
        {
          url: `${SITE}/api/v2/search`,
          json: { results: [], next_page: null },
        },
      ],
      config
    );
    await pullZendesk(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("maps priorities", () => {
    expect(impactOfPriority("low")).toBe(0.15);
    expect(impactOfPriority(null)).toBeNull();
  });
});
