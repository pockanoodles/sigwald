import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyAsana } from "@/lib/connectors/asana/client";
import { ASANA } from "@/lib/connectors/asana/service";

import asana from "@/modules/asana/manifest";
import { pullAsana } from "@/modules/asana/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const API = "https://app.asana.com/api/1.0";
const now = new Date("2026-11-11T15:00:00.000Z");

const task = (gid: string, over: Record<string, unknown> = {}) => ({
  gid,
  name: `Task ${gid}`,
  due_on: null,
  due_at: null,
  permalink_url: `https://app.asana.com/0/1/${gid}`,
  completed: false,
  completed_at: null,
  modified_at: "2026-11-11T12:00:00.000Z",
  projects: [{ gid: "500", name: "Launch" }],
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "pat" },
  config: { workspace: "42", userGid: "9" },
  settings: resolveSettings(asana.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const param = (url: string, name: string) =>
  new URL(url).searchParams.get(name);

describe("verifyAsana", () => {
  it("names the account and keeps its first workspace", async () => {
    const { http, calls } = fakeServiceHttp(ASANA, [
      {
        url: `${API}/users/me`,
        json: {
          data: {
            gid: "9",
            name: "Kai",
            workspaces: [
              { gid: "42", name: "Acme" },
              { gid: "43", name: "Other" },
            ],
          },
        },
      },
    ]);
    await expect(
      verifyAsana({ http, secret: { token: "t" }, config: {} })
    ).resolves.toEqual({
      label: "Kai",
      config: { userGid: "9", workspace: "42" },
    });
    expect(calls[0].headers.Authorization).toBe("Bearer t");
  });
});

describe("pullAsana", () => {
  it("makes tasks with moment and day dues, grouped by first project", async () => {
    const { http, calls } = fakeServiceHttp(ASANA, [
      {
        url: `${API}/tasks`,
        json: {
          data: [
            task("1", { due_on: "2026-11-20" }),
            task("2", {
              due_at: "2026-11-15T17:00:00.000Z",
              due_on: "2026-11-15",
              projects: [
                { gid: "501", name: "Ops" },
                { gid: "500", name: "Launch" },
              ],
            }),
            task("3", { projects: [] }),
          ],
          next_page: null,
        },
      },
    ]);
    const result = await pullAsana(ctx(http));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(param(calls[0].url, "assignee")).toBe("me");
    expect(param(calls[0].url, "workspace")).toBe("42");
    expect(param(calls[0].url, "completed_since")).toBe("now");
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "Task 1",
      due: { date: "2026-11-20" },
      group: { key: "asana:project:500", label: "Launch" },
      url: "https://app.asana.com/0/1/1",
    });
    expect(result.items[1]).toMatchObject({
      due: { at: new Date("2026-11-15T17:00:00.000Z") },
      group: { key: "asana:project:501", label: "Ops" },
      claims: [{ key: "asana:project:500", label: "Launch (Asana)" }],
    });
    expect(result.items[2]).toMatchObject({ group: null });
  });

  it("asks since the last pull and finishes held tasks completed since", async () => {
    const { http, calls } = fakeServiceHttp(ASANA, [
      {
        url: `${API}/tasks`,
        json: {
          data: [
            task("1"),
            task("7", {
              completed: true,
              completed_at: "2026-11-11T13:00:00.000Z",
            }),
            task("8", { completed: true }),
          ],
        },
      },
    ]);
    const result = await pullAsana(
      ctx(http, {
        lastSuccessAt: new Date("2026-11-11T14:00:00Z"),
        open: [{ externalId: "7", kind: "task", title: "Held title" }],
      })
    );
    expect(param(calls[0].url, "completed_since")).toBe(
      "2026-11-11T14:00:00.000Z"
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({
      kind: "task",
      externalId: "7",
      title: "Held title",
      state: "done",
      doneAt: new Date("2026-11-11T13:00:00.000Z"),
    });
  });

  it("follows the offset and is partial past the page cap", async () => {
    const { http, calls } = fakeServiceHttp(ASANA, [
      {
        url: `${API}/tasks`,
        json: { data: [task("1")], next_page: { offset: "abc" } },
      },
    ]);
    const result = await pullAsana(ctx(http));
    expect(calls).toHaveLength(5);
    expect(param(calls[1].url, "offset")).toBe("abc");
    expect(result.complete).toBe(false);
  });

  it("prefers the workspace set in settings", async () => {
    const { http, calls } = fakeServiceHttp(ASANA, [
      { url: `${API}/tasks`, json: { data: [] } },
    ]);
    await pullAsana(
      ctx(http, {
        settings: resolveSettings(asana.connect!.settings, {
          workspace: "77",
        }),
      })
    );
    expect(param(calls[0].url, "workspace")).toBe("77");
  });
});
