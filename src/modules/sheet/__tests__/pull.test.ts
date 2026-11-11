import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { WEB } from "@/lib/connectors/web/service";

import type { PullContext, PulledTask } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import { cellDay, parseCsv } from "@/modules/sheet/csv";
import sheet from "@/modules/sheet/manifest";
import { pullSheet } from "@/modules/sheet/pull";

const LINK = "https://docs.google.com/spreadsheets/d/e/abc/pub?output=csv";

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(sheet.connect!.settings, {
    link: LINK,
    title: "Task",
    ...settings,
  }),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("parseCsv", () => {
  it("reads quoted cells with commas, quotes and line breaks", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });
});

describe("cellDay", () => {
  it("reads the orders sheets write, and refuses days that don't exist", () => {
    expect(cellDay("2026-11-20 09:00:00", "ymd")).toBe("2026-11-20");
    expect(cellDay("11/20/2026", "mdy")).toBe("2026-11-20");
    expect(cellDay("20/11/26", "dmy")).toBe("2026-11-20");
    expect(cellDay("2/30/2026", "mdy")).toBeNull();
    expect(cellDay("soon", "ymd")).toBeNull();
  });
});

describe("pullSheet", () => {
  const CSV = [
    "Task,Due,Done,Link,Notes",
    'Cut the trailer,11/20/2026,,https://frame.io/x,"Two versions, 30s and 60s"',
    "Book the room,11/14/2026,TRUE,,",
    "Book the room,11/14/2026,,,",
    ",,,,",
  ].join("\n");

  it("makes a task per row from the named columns, done when the sheet says", async () => {
    const { http, calls } = fakeServiceHttp(WEB, [
      { url: LINK, text: CSV, headers: { "content-type": "text/csv" } },
    ]);
    const result = await pullSheet(
      ctx(http, {
        due: "Due",
        done: "done",
        url: "Link",
        note: "notes",
        dates: "mdy",
      })
    );
    expect(calls[0].method).toBe("GET");
    const tasks = result.items as PulledTask[];
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      title: "Cut the trailer",
      state: "open",
      due: { date: "2026-11-20" },
      url: "https://frame.io/x",
      description: "Two versions, 30s and 60s",
    });
    expect(tasks[1].state).toBe("done");
    expect(new Set(tasks.map((t) => t.externalId)).size).toBe(3);
    expect(result.complete).toBe(true);
  });

  it("names the columns it has when one it was told about isn't there", async () => {
    const { http } = fakeServiceHttp(WEB, [{ url: LINK, text: CSV }]);
    await expect(
      pullSheet(ctx(http, { due: "Deadline" }))
    ).rejects.toMatchObject({
      kind: "config",
      message: expect.stringContaining("Task, Due, Done, Link, Notes"),
    });
  });
});
