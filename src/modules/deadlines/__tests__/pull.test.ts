import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { WEB } from "@/lib/connectors/web/service";

import type { PullContext, PulledTask } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import deadlines from "@/modules/deadlines/manifest";
import { pullDeadlines } from "@/modules/deadlines/pull";

const now = new Date("2026-11-11T15:00:00.000Z");

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VEVENT",
  "UID:essay-1",
  "DTSTAMP:20261101T000000Z",
  "DTSTART:20261120T045900Z",
  "DTEND:20261120T045900Z",
  "SUMMARY:Essay 2 due",
  "DESCRIPTION:<p>Submit on <b>Gradescope</b></p>",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:grant-1",
  "DTSTAMP:20261101T000000Z",
  "DTSTART;VALUE=DATE:20261201",
  "DTEND;VALUE=DATE:20261202",
  "SUMMARY:Grant deadline",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:quiz-weekly",
  "DTSTAMP:20261101T000000Z",
  "DTSTART:20261113T170000Z",
  "DTEND:20261113T180000Z",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Weekly quiz due",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:gone-1",
  "DTSTAMP:20261101T000000Z",
  "DTSTART:20261118T170000Z",
  "DTEND:20261118T180000Z",
  "STATUS:CANCELLED",
  "SUMMARY:Cancelled due",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(deadlines.connect!.settings, settings),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("pullDeadlines", () => {
  it("makes a task per coming deadline, expanding repeats and skipping cancelled ones", async () => {
    const { http, calls } = fakeServiceHttp(WEB, [
      {
        url: "https://school.example.edu/me.ics",
        text: ICS,
        headers: { "content-type": "text/calendar" },
      },
    ]);
    const result = await pullDeadlines(
      ctx(http, { links: ["webcal://school.example.edu/me.ics"] })
    );
    expect(calls[0].url).toBe("https://school.example.edu/me.ics");
    expect(result.complete).toBe(true);
    const tasks = result.items as PulledTask[];
    expect(tasks.map((t) => t.title).sort()).toEqual([
      "Essay 2 due",
      "Grant deadline",
      "Weekly quiz due",
      "Weekly quiz due",
      "Weekly quiz due",
    ]);
    const essay = tasks.find((t) => t.title === "Essay 2 due")!;
    expect(essay.due).toEqual({ at: new Date("2026-11-20T04:59:00.000Z") });
    expect(essay.description).toBe("Submit on Gradescope");
    expect(essay.group).toMatchObject({ label: "school.example.edu" });
    expect(tasks.find((t) => t.title === "Grant deadline")!.due).toEqual({
      date: "2026-12-01",
    });
    expect(new Set(tasks.map((t) => t.externalId)).size).toBe(5);
  });

  it("keeps to events whose title has the word, and to the look-ahead", async () => {
    const { http } = fakeServiceHttp(WEB, [
      { url: "https://x.io/a.ics", text: ICS },
    ]);
    const result = await pullDeadlines(
      ctx(http, { links: ["https://x.io/a.ics"], only: "quiz", ahead: 7 })
    );
    expect(result.items.map((i) => i.title)).toEqual(["Weekly quiz due"]);
  });

  it("keeps the other links' work when one link fails, and says the pull was partial", async () => {
    const { http } = fakeServiceHttp(WEB, [
      { url: "https://x.io/ok.ics", text: ICS },
      { url: "https://x.io/broken.ics", status: 500, text: "oops" },
    ]);
    const result = await pullDeadlines(
      ctx(http, { links: ["https://x.io/ok.ics", "https://x.io/broken.ics"] })
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
  });
});
