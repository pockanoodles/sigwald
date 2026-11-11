import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyTodoist } from "@/lib/connectors/todoist/client";
import { TODOIST } from "@/lib/connectors/todoist/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import todoist from "@/modules/todoist/manifest";
import { pullTodoist } from "@/modules/todoist/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const API = "https://api.todoist.com/api/v1";

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  content: `Task ${id}`,
  description: "Notes",
  project_id: "P1",
  responsible_uid: null,
  priority: 4,
  labels: ["home"],
  due: { date: "2026-11-20", is_recurring: false },
  deadline: null,
  updated_at: "2026-11-11T12:00:00Z",
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "a".repeat(40) },
  config: { userId: "42" },
  settings: resolveSettings(todoist.connect!.settings, {}),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const projects = {
  url: `${API}/projects`,
  json: { results: [{ id: "P1", name: "Home" }], next_cursor: null },
};

describe("verifyTodoist", () => {
  it("names the user and keeps their id", async () => {
    const { http, calls } = fakeServiceHttp(TODOIST, [
      {
        url: `${API}/user`,
        json: { id: "42", full_name: "Maria Garcia", email: "m@x.com" },
      },
    ]);
    await expect(
      verifyTodoist({ http, secret: { token: "tok" }, config: {} })
    ).resolves.toEqual({ label: "Maria Garcia", config: { userId: "42" } });
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
  });
});

describe("pullTodoist", () => {
  it("maps priority, due, deadline and project, and drops tasks assigned to others", async () => {
    const { http, calls } = fakeServiceHttp(TODOIST, [
      {
        url: `${API}/tasks`,
        json: {
          results: [
            task("t1"),
            task("t2", {
              priority: 3,
              due: { date: "2026-11-20T09:30:00", timezone: null },
              deadline: { date: "2026-11-25" },
            }),
            task("t3", {
              priority: 1,
              due: { date: "2026-11-20T14:00:00Z", timezone: "Europe/Madrid" },
            }),
            task("t4", { responsible_uid: "99" }),
            task("t5", { responsible_uid: "42", due: null, priority: 2 }),
          ],
          next_cursor: null,
        },
      },
      projects,
    ]);
    const result = await pullTodoist(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(result.items.map((i) => i.externalId)).toEqual([
      "t1",
      "t2",
      "t3",
      "t5",
    ]);
    expect(result.items[0]).toMatchObject({
      title: "Task t1",
      impact: 0.9,
      due: { date: "2026-11-20" },
      group: { key: "todoist:project:p1", label: "Home" },
      url: "https://app.todoist.com/app/task/t1",
    });
    expect(result.items[1]).toMatchObject({
      impact: 0.7,
      due: { date: "2026-11-25" },
    });
    expect(result.items[2]).toMatchObject({
      impact: null,
      due: { at: new Date("2026-11-20T14:00:00Z") },
    });
    expect(result.items[3]).toMatchObject({ impact: 0.4, due: null });
  });

  it("reads a floating time on the person's clock", async () => {
    const { http } = fakeServiceHttp(TODOIST, [
      {
        url: `${API}/tasks`,
        json: {
          results: [task("t2", { due: { date: "2026-11-20T09:30:00" } })],
          next_cursor: null,
        },
      },
      projects,
    ]);
    const result = await pullTodoist(ctx(http));
    expect(result.items[0]).toMatchObject({
      due: { at: new Date("2026-11-20T14:30:00Z") },
    });
  });

  it("follows the cursor, and is partial when pages run out", async () => {
    const { http, calls } = fakeServiceHttp(TODOIST, [
      {
        url: `${API}/tasks?limit=200&cursor=c1`,
        json: { results: [task("t2")], next_cursor: "c2" },
      },
      {
        url: `${API}/tasks`,
        json: { results: [task("t1")], next_cursor: "c1" },
      },
      projects,
    ]);
    const result = await pullTodoist(ctx(http));
    expect(result.items.map((i) => i.externalId)).toEqual(["t1", "t2"]);
    expect(calls.some((c) => c.url.includes("cursor=c1"))).toBe(true);
    expect(result.complete).toBe(false);
  });

  it("finishes held tasks that were completed, keeping their title", async () => {
    const { http, calls } = fakeServiceHttp(TODOIST, [
      {
        url: `${API}/tasks/completed/by_completion_date`,
        json: {
          items: [
            task("t9", { completed_at: "2026-11-11T14:50:00Z" }),
            task("zz", { completed_at: "2026-11-11T14:51:00Z" }),
          ],
          next_cursor: null,
        },
      },
      { url: `${API}/tasks`, json: { results: [], next_cursor: null } },
      projects,
    ]);
    const result = await pullTodoist(
      ctx(http, {
        open: [{ externalId: "t9", kind: "task", title: "Held" }],
        lastSuccessAt: new Date("2026-11-11T14:45:00.000Z"),
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "t9",
        title: "Held",
        state: "done",
        doneAt: new Date("2026-11-11T14:50:00Z"),
      }),
    ]);
    const completed = calls.find((c) => c.url.includes("by_completion_date"))!;
    expect(new URL(completed.url).searchParams.get("since")).toBe(
      "2026-11-11T13:45:00.000Z"
    );
    expect(result.complete).toBe(true);
  });
});
