import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyLinear } from "@/lib/connectors/linear/client";
import { LINEAR } from "@/lib/connectors/linear/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import linear from "@/modules/linear/manifest";
import { impactOfPriority, pullLinear } from "@/modules/linear/pull";

const API = "https://api.linear.app/graphql";
const now = new Date("2026-11-11T15:00:00.000Z");

const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  identifier: `ENG-${id}`,
  title: `Issue ${id}`,
  url: `https://linear.app/acme/issue/ENG-${id}`,
  priority: 2,
  priorityLabel: "High",
  dueDate: null,
  estimate: 3,
  updatedAt: "2026-11-11T10:00:00.000Z",
  description: "Do it",
  state: { name: "In Progress", type: "started" },
  team: { key: "ENG", name: "Engineering" },
  project: { id: "p1", name: "Launch" },
  cycle: { number: 12, endsAt: "2026-11-14T05:00:00.000Z" },
  labels: { nodes: [{ name: "bug" }] },
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { key: "lin_api_abcdefghijklmnopqrstuvwxyz" },
  config: {},
  settings: resolveSettings(linear.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyLinear", () => {
  it("sends the key as it is and names the account", async () => {
    const { http, calls } = fakeServiceHttp(LINEAR, [
      {
        method: "POST",
        url: API,
        json: { data: { viewer: { id: "u1", name: "Kai", email: "k@x.io" } } },
      },
    ]);
    await expect(
      verifyLinear({ http, secret: { key: "lin_api_x" }, config: {} })
    ).resolves.toEqual({
      label: "Kai",
      config: { viewerId: "u1" },
    });
    expect(calls[0].headers.Authorization).toBe("lin_api_x");
  });

  it("reads Linear's authentication error as a refused key", async () => {
    const { http } = fakeServiceHttp(LINEAR, [
      {
        method: "POST",
        url: API,
        json: {
          errors: [
            {
              message: "Authentication required",
              extensions: { code: "AUTHENTICATION_ERROR" },
            },
          ],
        },
      },
    ]);
    await expect(
      verifyLinear({ http, secret: { key: "lin_api_x" }, config: {} })
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("pullLinear", () => {
  it("makes a task per open issue, weighted by priority, due by its date or cycle", async () => {
    const { http, calls } = fakeServiceHttp(LINEAR, [
      {
        method: "POST",
        url: API,
        body: /Assigned/,
        json: {
          data: {
            viewer: {
              assignedIssues: {
                nodes: [
                  issue("1"),
                  issue("2", {
                    dueDate: "2026-11-20",
                    priority: 1,
                    project: null,
                  }),
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      },
    ]);
    const result = await pullLinear(ctx(http));
    expect(calls).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "ENG-1 Issue 1",
      impact: 0.7,
      due: { at: new Date("2026-11-14T05:00:00.000Z") },
      group: { key: "linear:team:eng", label: "Engineering" },
      claims: [{ key: "linear:project:p1", label: "Launch (Linear)" }],
    });
    expect(result.items[1]).toMatchObject({
      due: { date: "2026-11-20" },
      impact: 0.9,
      claims: [],
    });
  });

  it("finishes what it held once Linear says it's completed", async () => {
    const { http } = fakeServiceHttp(LINEAR, [
      {
        method: "POST",
        url: API,
        body: /Assigned/,
        json: {
          data: {
            viewer: {
              assignedIssues: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      },
      {
        method: "POST",
        url: API,
        body: /Finished/,
        json: {
          data: {
            viewer: {
              assignedIssues: {
                nodes: [{ id: "9", completedAt: "2026-11-11T09:00:00.000Z" }],
              },
            },
          },
        },
      },
    ]);
    const result = await pullLinear(
      ctx(http, {
        open: [
          { externalId: "9", kind: "task", title: "ENG-9 Old" },
          { externalId: "8", kind: "task", title: "x" },
        ],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "9",
        title: "ENG-9 Old",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00.000Z"),
      },
    ]);
  });
});

describe("impactOfPriority", () => {
  it("maps Linear's scale", () => {
    expect([0, 1, 2, 3, 4].map(impactOfPriority)).toEqual([
      null,
      0.9,
      0.7,
      0.4,
      0.15,
    ]);
  });
});
