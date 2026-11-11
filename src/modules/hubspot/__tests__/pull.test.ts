import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyHubspot } from "@/lib/connectors/hubspot/client";
import { HUBSPOT } from "@/lib/connectors/hubspot/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import hubspot from "@/modules/hubspot/manifest";
import { impactOfPriority, pullHubspot } from "@/modules/hubspot/pull";

const SEARCH = "https://api.hubapi.com/crm/v3/objects/tasks/search";
const now = new Date("2026-11-11T15:00:00.000Z");

const task = (id: string, over: Record<string, string> = {}) => ({
  id,
  properties: {
    hs_task_subject: `Task ${id}`,
    hs_timestamp: "2026-11-12T14:00:00.000Z",
    hs_task_priority: "HIGH",
    hs_task_status: "NOT_STARTED",
    hs_task_type: "TODO",
    hs_task_body: "<p>Send the quote</p>",
    hs_lastmodifieddate: "2026-11-10T10:00:00.000Z",
    ...over,
  },
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "pat-na1-abcdefghijklmnopqrstuvwxyz" },
  config: { ownerId: "77", email: "kai@example.com" },
  settings: resolveSettings(hubspot.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyHubspot", () => {
  it("finds your owner id by email and names you", async () => {
    const { http, calls } = fakeServiceHttp(HUBSPOT, [
      {
        url: "https://api.hubapi.com/crm/v3/owners",
        json: {
          results: [
            {
              id: "77",
              email: "Kai@example.com",
              firstName: "Kai",
              lastName: "Soeno",
            },
          ],
        },
      },
    ]);
    await expect(
      verifyHubspot({
        http,
        secret: { token: "pat-x" },
        config: { email: "kai@example.com" },
      })
    ).resolves.toEqual({
      label: "Kai Soeno",
      config: { ownerId: "77", ownerName: "Kai Soeno" },
    });
    expect(calls[0].url).toContain("email=kai%40example.com");
    expect(calls[0].headers.Authorization).toBe("Bearer pat-x");
  });

  it("refuses an email HubSpot has no owner for", async () => {
    const { http } = fakeServiceHttp(HUBSPOT, [
      { url: "https://api.hubapi.com/crm/v3/owners", json: { results: [] } },
    ]);
    await expect(
      verifyHubspot({
        http,
        secret: { token: "pat-x" },
        config: { email: "no@example.com" },
      })
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("pullHubspot", () => {
  it("makes a task per open task, weighted by priority, due when HubSpot says", async () => {
    const { http, calls } = fakeServiceHttp(HUBSPOT, [
      {
        method: "POST",
        url: SEARCH,
        json: {
          results: [
            task("1"),
            task("2", {
              hs_task_type: "CALL",
              hs_task_priority: "LOW",
              hs_timestamp: "1794000000000",
            }),
            task("3", { hs_task_priority: "", hs_task_subject: "" }),
          ],
        },
      },
    ]);
    const result = await pullHubspot(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toContain('"hubspot_owner_id"');
    expect(calls[0].body).toContain('"NEQ"');
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "Task 1",
      impact: 0.7,
      due: { at: new Date("2026-11-12T14:00:00.000Z") },
      description: "Send the quote",
      group: { key: "hubspot:owner:77" },
    });
    expect(result.items[1]).toMatchObject({
      title: "Call: Task 2",
      impact: 0.15,
      due: { at: new Date(1794000000000) },
    });
    expect(result.items[2]).toMatchObject({
      title: "Untitled task",
      impact: null,
    });
  });

  it("reports held tasks that are completed now as done", async () => {
    const { http, calls } = fakeServiceHttp(HUBSPOT, [
      {
        method: "POST",
        url: SEARCH,
        body: /NEQ/,
        json: { results: [task("1")] },
      },
      {
        method: "POST",
        url: SEARCH,
        body: /"IN"/,
        json: {
          results: [
            task("9", {
              hs_task_status: "COMPLETED",
              hs_task_completion_date: "2026-11-11T12:00:00.000Z",
            }),
          ],
        },
      },
    ]);
    const result = await pullHubspot(
      ctx(http, {
        open: [
          { externalId: "1", kind: "task", title: "Task 1" },
          { externalId: "9", kind: "task", title: "Held nine" },
          { externalId: "8", kind: "task", title: "Dropped eight" },
        ],
      })
    );
    expect(result.items).toContainEqual({
      kind: "task",
      externalId: "9",
      title: "Held nine",
      state: "done",
      doneAt: new Date("2026-11-11T12:00:00.000Z"),
    });
    expect(result.items.some((i) => i.externalId === "8")).toBe(false);
    expect(calls[1].body).toContain('"values":["9","8"]');
  });

  it("says the answer is partial when there are more pages than it reads", async () => {
    const { http } = fakeServiceHttp(HUBSPOT, [
      {
        method: "POST",
        url: SEARCH,
        json: { results: [task("1")], paging: { next: { after: "100" } } },
      },
    ]);
    const result = await pullHubspot(ctx(http));
    expect(result.complete).toBe(false);
  });

  it("only reads: every call is the search POST or a GET", async () => {
    const { http, calls } = fakeServiceHttp(HUBSPOT, [
      { method: "POST", url: SEARCH, json: { results: [] } },
    ]);
    await pullHubspot(ctx(http));
    expect(calls.every((c) => c.method === "POST" && c.url === SEARCH)).toBe(
      true
    );
  });

  it("maps priorities", () => {
    expect(impactOfPriority("MEDIUM")).toBe(0.4);
    expect(impactOfPriority("NONE")).toBeNull();
  });
});
