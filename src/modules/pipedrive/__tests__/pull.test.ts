import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyPipedrive } from "@/lib/connectors/pipedrive/client";
import { PIPEDRIVE } from "@/lib/connectors/pipedrive/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import pipedrive from "@/modules/pipedrive/manifest";
import { minutesOf, pullPipedrive } from "@/modules/pipedrive/pull";

const V2 = "https://api.pipedrive.com/api/v2";
const now = new Date("2026-11-11T15:00:00.000Z");

const activity = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  subject: `Activity ${id}`,
  type: "call",
  owner_id: 5,
  deal_id: 11,
  person_id: 22,
  org_id: 33,
  due_date: "2026-11-12",
  due_time: "15:00:00",
  duration: "00:30:00",
  done: false,
  marked_as_done_time: null,
  update_time: "2026-11-10T10:00:00Z",
  note: "<p>Ask about renewal</p>",
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "abcdefghijklmnopqrstuvwxyz0123456789abcd" },
  config: { userId: "5", companyDomain: "acme" },
  settings: resolveSettings(pipedrive.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const names = [
  {
    url: `${V2}/deals`,
    json: { success: true, data: [{ id: 11, title: "Acme renewal" }] },
  },
  {
    url: `${V2}/persons`,
    json: { success: true, data: [{ id: 22, name: "Dana Reyes" }] },
  },
  {
    url: `${V2}/organizations`,
    json: { success: true, data: [{ id: 33, name: "Acme Inc" }] },
  },
];

describe("verifyPipedrive", () => {
  it("sends the token in the header and keeps the user id and domain", async () => {
    const { http, calls } = fakeServiceHttp(PIPEDRIVE, [
      {
        url: "https://api.pipedrive.com/v1/users/me",
        json: {
          success: true,
          data: { id: 5, name: "Kai Soeno", company_domain: "acme" },
        },
      },
    ]);
    await expect(
      verifyPipedrive({ http, secret: { token: "tok" }, config: {} })
    ).resolves.toEqual({
      label: "Kai Soeno",
      config: { userId: "5", companyDomain: "acme" },
    });
    expect(calls[0].headers["x-api-token"]).toBe("tok");
    expect(calls[0].url).not.toContain("api_token");
  });
});

describe("pullPipedrive", () => {
  it("makes a task per undone activity with its due, length and names", async () => {
    const { http, calls } = fakeServiceHttp(PIPEDRIVE, [
      {
        url: `${V2}/activities`,
        json: {
          success: true,
          data: [
            activity(1),
            activity(2, {
              type: "task",
              due_time: null,
              duration: "",
              deal_id: null,
              person_id: null,
              org_id: null,
            }),
            activity(3, { due_date: null, due_time: null, subject: "" }),
          ],
          additional_data: { next_cursor: null },
        },
      },
      ...names,
    ]);
    const result = await pullPipedrive(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls[0].url).toContain("owner_id=5");
    expect(calls[0].url).toContain("done=false");
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "Call: Activity 1",
      due: { at: new Date("2026-11-12T15:00:00.000Z") },
      minutes: 30,
      description: "Ask about renewal",
      group: { key: "pipedrive:deal:11", label: "Acme renewal" },
    });
    expect(result.items[0]).toMatchObject({
      facts: [
        { label: "Type", value: "Call" },
        { label: "Deal", value: "Acme renewal" },
        { label: "Person", value: "Dana Reyes" },
        { label: "Organization", value: "Acme Inc" },
      ],
    });
    expect(result.items[1]).toMatchObject({
      title: "Task: Activity 2",
      due: { date: "2026-11-12" },
      minutes: null,
      group: { key: "pipedrive:activities" },
    });
    expect(result.items[2]).toMatchObject({
      title: "Call: Untitled activity",
      due: null,
    });
  });

  it("reports held activities that are marked done now", async () => {
    const { http, calls } = fakeServiceHttp(PIPEDRIVE, [
      {
        url: `${V2}/activities?owner_id`,
        json: { success: true, data: [], additional_data: {} },
      },
      {
        url: `${V2}/activities?ids`,
        json: {
          success: true,
          data: [
            activity(9, {
              done: true,
              marked_as_done_time: "2026-11-11T12:00:00Z",
            }),
          ],
        },
      },
    ]);
    const result = await pullPipedrive(
      ctx(http, {
        open: [
          { externalId: "9", kind: "task", title: "Call: Held nine" },
          { externalId: "8", kind: "task", title: "Call: Dropped eight" },
        ],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "9",
        title: "Call: Held nine",
        state: "done",
        doneAt: new Date("2026-11-11T12:00:00.000Z"),
      },
      // Not done and, by a complete list, not yours any more: gone.
      {
        kind: "task",
        externalId: "8",
        title: "Call: Dropped eight",
        state: "gone",
      },
    ]);
    expect(calls[1].url).toContain("ids=9%2C8");
    expect(calls[1].url).toContain("done=true");
  });

  it("says the answer is partial when there are more pages than it reads", async () => {
    const { http } = fakeServiceHttp(PIPEDRIVE, [
      {
        url: `${V2}/activities`,
        json: {
          success: true,
          data: [activity(1)],
          additional_data: { next_cursor: "abc" },
        },
      },
      ...names,
    ]);
    expect((await pullPipedrive(ctx(http))).complete).toBe(false);
  });

  it("keeps the tasks when a name lookup fails", async () => {
    const { http } = fakeServiceHttp(PIPEDRIVE, [
      {
        url: `${V2}/activities`,
        json: { success: true, data: [activity(1)], additional_data: {} },
      },
      { url: `${V2}/deals`, status: 403, json: {} },
      names[1],
      names[2],
    ]);
    const result = await pullPipedrive(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      group: { key: "pipedrive:deal:11", label: "Deal 11" },
    });
  });

  it("only reads", async () => {
    const { http, calls } = fakeServiceHttp(PIPEDRIVE, [
      {
        url: `${V2}/activities`,
        json: { success: true, data: [], additional_data: {} },
      },
    ]);
    await pullPipedrive(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("reads durations", () => {
    expect(minutesOf("01:30:00")).toBe(90);
    expect(minutesOf("00:00:00")).toBeNull();
  });
});
