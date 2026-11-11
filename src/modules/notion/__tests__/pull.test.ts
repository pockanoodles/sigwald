import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyNotion } from "@/lib/connectors/notion/client";
import { NOTION } from "@/lib/connectors/notion/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import notion from "@/modules/notion/manifest";
import { databaseId, pullNotion } from "@/modules/notion/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const DB = "a".repeat(32);
const API = "https://api.notion.com/v1";

const schema = {
  id: DB,
  title: [{ plain_text: "Project " }, { plain_text: "tracker" }],
  properties: {
    Name: { id: "title", name: "Name", type: "title" },
    Owner: { id: "o", name: "Owner", type: "people" },
    Due: { id: "d", name: "Due", type: "date" },
    Status: { id: "s", name: "Status", type: "status" },
  },
};

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://www.notion.so/${id}`,
  last_edited_time: "2026-11-11T12:00:00.000Z",
  properties: {
    Name: { type: "title", title: [{ plain_text: `Row ${id}` }] },
    Due: { type: "date", date: { start: "2026-11-20", end: null } },
    Status: { type: "status", status: { name: "In progress" } },
    ...over,
  },
});

const ctx = (
  http: PullContext["http"],
  stored: Record<string, unknown> = {},
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "ntn_" + "x".repeat(30) },
  config: {},
  settings: resolveSettings(notion.connect!.settings, {
    databases: [DB],
    ...stored,
  }),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("databaseId", () => {
  it("takes the id from an address, a bare id or a dashed one", () => {
    expect(databaseId(DB)).toBe(DB);
    expect(
      databaseId(`https://www.notion.so/team/Tracker-${DB}?v=${"b".repeat(32)}`)
    ).toBe(DB);
    expect(databaseId("12345678-1234-1234-1234-123456789ABC")).toBe(
      "123456781234123412341234" + "56789abc"
    );
    expect(databaseId("nothing here")).toBeNull();
  });
});

describe("verifyNotion", () => {
  it("names the integration and its workspace", async () => {
    const { http, calls } = fakeServiceHttp(NOTION, [
      {
        url: `${API}/users/me`,
        json: { name: "Sigwald", bot: { workspace_name: "Acme" } },
      },
    ]);
    await expect(
      verifyNotion({ http, secret: { token: "ntn_x" }, config: {} })
    ).resolves.toEqual({ label: "Sigwald (Acme)" });
    expect(calls[0].headers["Notion-Version"]).toBe("2022-06-28");
    expect(calls[0].headers.Authorization).toBe("Bearer ntn_x");
  });
});

describe("pullNotion", () => {
  it("makes tasks from rows, using the first date and status properties", async () => {
    const { http, calls } = fakeServiceHttp(NOTION, [
      {
        url: `${API}/databases/${DB}/query`,
        method: "POST",
        json: {
          results: [
            row("p1"),
            row("p2", {
              Due: {
                type: "date",
                date: {
                  start: "2026-11-21T09:00:00",
                  time_zone: "America/New_York",
                },
              },
            }),
            row("p3", { Status: { type: "status", status: { name: "Done" } } }),
          ],
          has_more: false,
          next_cursor: null,
        },
      },
      { url: `${API}/databases/${DB}`, json: schema },
    ]);
    const result = await pullNotion(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(JSON.parse(calls[1].body!)).toEqual({ page_size: 100 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "p1",
      title: "Row p1",
      state: "open",
      due: { date: "2026-11-20" },
      group: { key: `notion:db:${DB}`, label: "Project tracker" },
      url: "https://www.notion.so/p1",
    });
    expect(result.items[1]).toMatchObject({
      due: { at: new Date("2026-11-21T14:00:00.000Z") },
    });
  });

  it("finishes a held row that's done, by a checkbox or a done value", async () => {
    const boxes = {
      ...schema,
      properties: {
        Name: schema.properties.Name,
        Date: { id: "d", name: "Date", type: "date" },
        Shipped: { id: "c", name: "Shipped", type: "checkbox" },
      },
    };
    const { http } = fakeServiceHttp(NOTION, [
      {
        url: `${API}/databases/${DB}/query`,
        method: "POST",
        json: {
          results: [
            row("p1", { Shipped: { type: "checkbox", checkbox: true } }),
            row("p2", { Shipped: { type: "checkbox", checkbox: true } }),
            row("p3", { Shipped: { type: "checkbox", checkbox: false } }),
          ],
          has_more: false,
        },
      },
      { url: `${API}/databases/${DB}`, json: boxes },
    ]);
    const result = await pullNotion(
      ctx(
        http,
        { dateProperty: "Date" },
        { open: [{ externalId: "p1", kind: "task", title: "Held" }] }
      )
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "p1",
        title: "Held",
        state: "done",
        doneAt: new Date("2026-11-11T12:00:00.000Z"),
      }),
      expect.objectContaining({ externalId: "p3", state: "open" }),
    ]);
  });

  it("honours a named status property and done values", async () => {
    const { http } = fakeServiceHttp(NOTION, [
      {
        url: `${API}/databases/${DB}/query`,
        method: "POST",
        json: {
          results: [
            row("p1", {
              Owner: { type: "select", select: { name: "shipped" } },
            }),
          ],
          has_more: false,
        },
      },
      {
        url: `${API}/databases/${DB}`,
        json: {
          ...schema,
          properties: {
            ...schema.properties,
            Owner: { id: "o", name: "Owner", type: "select" },
          },
        },
      },
    ]);
    const result = await pullNotion(
      ctx(
        http,
        { statusProperty: "owner", done: ["Shipped"] },
        { open: [{ externalId: "p1", kind: "task", title: "Held" }] }
      )
    );
    expect(result.items[0]).toMatchObject({ state: "done", title: "Held" });
  });

  it("is partial past three pages, and when a database isn't shared", async () => {
    const OTHER = "b".repeat(32);
    const { http, calls } = fakeServiceHttp(NOTION, [
      {
        url: `${API}/databases/${OTHER}`,
        status: 404,
        json: { message: "no" },
      },
      {
        url: `${API}/databases/${DB}/query`,
        method: "POST",
        json: {
          results: [row("p1")],
          has_more: true,
          next_cursor: "n",
        },
      },
      { url: `${API}/databases/${DB}`, json: schema },
    ]);
    const result = await pullNotion(ctx(http, { databases: [DB, OTHER] }));
    expect(result.complete).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
    expect(result.items).toHaveLength(3);
  });
});
