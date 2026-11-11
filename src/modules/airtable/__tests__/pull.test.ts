import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyAirtable } from "@/lib/connectors/airtable/client";
import { AIRTABLE } from "@/lib/connectors/airtable/service";

import airtable from "@/modules/airtable/manifest";
import { pullAirtable } from "@/modules/airtable/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const now = new Date("2026-11-11T15:00:00.000Z");
const LIST = "https://api.airtable.com/v0/appABCDEFGH12345/Tasks";

const rec = (id: string, fields: Record<string, unknown>) => ({
  id,
  createdTime: "2026-11-01T00:00:00.000Z",
  fields,
});

const ctx = (
  http: PullContext["http"],
  stored: Record<string, unknown> = {},
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "pat" + "x".repeat(30) },
  config: {},
  settings: resolveSettings(airtable.connect!.settings, {
    base: "appABCDEFGH12345",
    table: "Tasks",
    titleField: "Name",
    dueField: "Due",
    doneField: "Done",
    ...stored,
  }),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyAirtable", () => {
  it("names the token's owner", async () => {
    const { http, calls } = fakeServiceHttp(AIRTABLE, [
      {
        url: "https://api.airtable.com/v0/meta/whoami",
        json: { id: "usrABC", email: "k@x.com" },
      },
    ]);
    await expect(
      verifyAirtable({ http, secret: { token: "pat1" }, config: {} })
    ).resolves.toEqual({ label: "k@x.com" });
    expect(calls[0].headers.Authorization).toBe("Bearer pat1");
  });
});

describe("pullAirtable", () => {
  it("makes tasks from records with title, due and a table group", async () => {
    const { http, calls } = fakeServiceHttp(AIRTABLE, [
      {
        url: LIST,
        json: {
          records: [
            rec("rec1", { Name: "Ship it", Due: "2026-11-20" }),
            rec("rec2", { Name: "Call", Due: "2026-11-21T15:00:00.000Z" }),
            rec("rec3", {}),
          ],
        },
      },
    ]);
    const result = await pullAirtable(ctx(http, { view: "Open" }));
    expect(result.complete).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("pageSize")).toBe("100");
    expect(query.get("view")).toBe("Open");
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "rec1",
        title: "Ship it",
        due: { date: "2026-11-20" },
        url: "https://airtable.com/appABCDEFGH12345/Tasks/rec1",
        group: { key: "airtable:table:appabcdefgh12345/tasks", label: "Tasks" },
      }),
      expect.objectContaining({
        externalId: "rec2",
        due: { at: new Date("2026-11-21T15:00:00.000Z") },
      }),
      expect.objectContaining({
        externalId: "rec3",
        title: "Untitled",
        due: null,
      }),
    ]);
  });

  it("finishes a held record whose box is ticked", async () => {
    const { http } = fakeServiceHttp(AIRTABLE, [
      {
        url: LIST,
        json: {
          records: [
            rec("rec1", { Name: "Ship it", Done: true }),
            rec("rec2", { Name: "Other", Done: true }),
            rec("rec3", { Name: "Open one" }),
          ],
        },
      },
    ]);
    const result = await pullAirtable(
      ctx(
        http,
        {},
        { open: [{ externalId: "rec1", kind: "task", title: "Held" }] }
      )
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "rec1",
        title: "Held",
        state: "done",
        doneAt: now,
      }),
      expect.objectContaining({ externalId: "rec3", state: "open" }),
    ]);
  });

  it("follows the offset for five pages, then says it's partial", async () => {
    const { http, calls } = fakeServiceHttp(AIRTABLE, [
      { url: LIST, json: { records: [rec("r", { Name: "x" })], offset: "o1" } },
    ]);
    const result = await pullAirtable(ctx(http));
    expect(calls).toHaveLength(5);
    expect(calls[1].url).toContain("offset=o1");
    expect(result.complete).toBe(false);
  });
});
