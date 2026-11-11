import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyClickup } from "@/lib/connectors/clickup/client";
import { CLICKUP } from "@/lib/connectors/clickup/service";

import clickup from "@/modules/clickup/manifest";
import { pullClickup } from "@/modules/clickup/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const now = new Date("2026-11-11T15:00:00.000Z");
const TASKS = "https://api.clickup.com/api/v2/team/900/task";

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Task ${id}`,
  text_content: "Words",
  status: { status: "in progress", type: "custom" },
  priority: { id: "2", priority: "high" },
  due_date: "1795003200000",
  due_date_time: true,
  date_updated: "1794999999000",
  date_closed: null,
  url: `https://app.clickup.com/t/${id}`,
  list: { id: "L1", name: "Sprint 4" },
  folder: { name: "Product" },
  tags: [{ name: "api" }],
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "pk_12345678_ABCDEFGHIJ" },
  config: { userId: "77", teamId: "900" },
  settings: resolveSettings(clickup.connect!.settings, {}),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyClickup", () => {
  it("names the user and keeps the first workspace", async () => {
    const { http, calls } = fakeServiceHttp(CLICKUP, [
      {
        url: "https://api.clickup.com/api/v2/user",
        json: { user: { id: 77, username: "kaito" } },
      },
      {
        url: "https://api.clickup.com/api/v2/team",
        json: { teams: [{ id: "900", name: "Acme" }] },
      },
    ]);
    await expect(
      verifyClickup({ http, secret: { token: "pk_x" }, config: {} })
    ).resolves.toEqual({
      label: "kaito (Acme)",
      config: { userId: "77", teamId: "900" },
    });
    expect(calls[0].headers.Authorization).toBe("pk_x");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("pullClickup", () => {
  it("makes tasks with impact, due, list group and facts", async () => {
    const { http, calls } = fakeServiceHttp(CLICKUP, [
      {
        url: TASKS,
        json: {
          tasks: [
            task("a1"),
            task("a2", {
              priority: null,
              due_date: "1795003200000",
              due_date_time: false,
            }),
          ],
        },
      },
    ]);
    const result = await pullClickup(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.searchParams.getAll("assignees[]")).toEqual(["77"]);
    expect(url.searchParams.get("include_closed")).toBeNull();
    expect(result.items[0]).toMatchObject({
      externalId: "a1",
      title: "Task a1",
      state: "open",
      impact: 0.7,
      due: { at: new Date(1795003200000) },
      group: { key: "clickup:list:l1", label: "Sprint 4" },
      url: "https://app.clickup.com/t/a1",
    });
    expect(result.items[0]).toMatchObject({
      facts: expect.arrayContaining([{ label: "List", value: "Sprint 4" }]),
    });
    expect(result.items[1]).toMatchObject({
      impact: null,
      due: { date: "2026-11-18" },
    });
  });

  it("uses the workspace setting over the first one", async () => {
    const { http, calls } = fakeServiceHttp(CLICKUP, [
      {
        url: "https://api.clickup.com/api/v2/team/123/task",
        json: { tasks: [] },
      },
    ]);
    await pullClickup(
      ctx(http, {
        settings: resolveSettings(clickup.connect!.settings, { team: "123" }),
      })
    );
    expect(calls[0].url).toContain("/team/123/task");
  });

  it("finishes held tasks that were closed, keeping their title", async () => {
    const { http, calls } = fakeServiceHttp(CLICKUP, [
      {
        url: /include_closed=true/,
        json: {
          tasks: [
            task("a9", {
              status: { status: "complete", type: "closed" },
              date_closed: "1794990000000",
            }),
            task("b1", { date_closed: null }),
          ],
        },
      },
      { url: TASKS, json: { tasks: [] } },
    ]);
    const result = await pullClickup(
      ctx(http, {
        open: [
          { externalId: "a9", kind: "task", title: "Held title" },
          { externalId: "b1", kind: "task", title: "Still open elsewhere" },
        ],
        lastSuccessAt: new Date("2026-11-11T14:45:00.000Z"),
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "a9",
        title: "Held title",
        state: "done",
        doneAt: new Date(1794990000000),
      }),
    ]);
    const since = new URL(calls[1].url).searchParams.get("date_updated_gt");
    expect(Number(since)).toBe(
      new Date("2026-11-11T14:45:00.000Z").getTime() - 3_600_000
    );
    expect(result.complete).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("says it's partial when more pages remain than it reads", async () => {
    const full = Array.from({ length: 100 }, (_, i) => task(`t${i}`));
    const { http } = fakeServiceHttp(CLICKUP, [
      { url: TASKS, json: { tasks: full } },
    ]);
    const result = await pullClickup(ctx(http));
    expect(result.items).toHaveLength(100);
    expect(result.complete).toBe(false);
  });
});
