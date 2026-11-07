import ICAL from "ical.js";

import {
  buildPlanCalendar,
  hashToken,
  newSubscriptionToken,
  type PlanEvent,
  type PlanTask,
} from "@/lib/ical-out";

describe("newSubscriptionToken / hashToken", () => {
  it("returns a base64url token whose sha256 hex is tokenHash", () => {
    const { token, tokenHash } = newSubscriptionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("buildPlanCalendar", () => {
  const now = new Date(Date.UTC(2026, 10, 7, 12, 0, 0));

  it("emits a valid empty calendar with the header properties", () => {
    const text = buildPlanCalendar({ tasks: [], events: [], now });
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("VERSION:2.0\r\n");
    expect(text).toContain("PRODID:-//Sigwald//Plan//EN\r\n");
    expect(text).toContain("CALSCALE:GREGORIAN\r\n");
    expect(text).toContain("METHOD:PUBLISH\r\n");
    expect(text).toContain("X-WR-CALNAME:Sigwald\r\n");
    expect(text).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M\r\n");
    expect(text).toContain("X-PUBLISHED-TTL:PT15M\r\n");
    expect(() => ICAL.parse(text)).not.toThrow();
  });

  it("escapes TEXT values and folds lines at 75 octets with CRLF", () => {
    const longTitle =
      "Meet; review, plan\\" + "x".repeat(80) + "\nnext line";
    const task: PlanTask = {
      id: "t1",
      title: longTitle,
      description: "a;b,c\\d\ne",
      scheduledStart: new Date(Date.UTC(2026, 10, 8, 14, 0, 0)),
      scheduledEnd: new Date(Date.UTC(2026, 10, 8, 15, 0, 0)),
      updatedAt: new Date(Date.UTC(2026, 10, 7, 10, 0, 0)),
    };
    const text = buildPlanCalendar({ tasks: [task], events: [], now });

    expect(text).toContain("\\\\");
    expect(text).toContain("\\;");
    expect(text).toContain("\\,");
    expect(text).toContain("\\n");

    for (const physical of text.split("\r\n").filter((l) => l.length > 0)) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    }

    const folded = text
      .split("\r\n")
      .filter((l) => l.startsWith(" ") || l.startsWith("SUMMARY:"));
    expect(folded.some((l) => l.startsWith(" "))).toBe(true);

    expect(() => ICAL.parse(text)).not.toThrow();
  });

  it("formats timed values as UTC YYYYMMDDTHHMMSSZ", () => {
    const task: PlanTask = {
      id: "t2",
      title: "Focus",
      description: null,
      scheduledStart: new Date(Date.UTC(2026, 0, 2, 9, 30, 0)),
      scheduledEnd: new Date(Date.UTC(2026, 0, 2, 10, 0, 0)),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 8, 0, 0)),
    };
    const text = buildPlanCalendar({ tasks: [task], events: [], now });
    expect(text).toContain("DTSTART:20260102T093000Z");
    expect(text).toContain("DTEND:20260102T100000Z");
    expect(text).toContain("DTSTAMP:20261107T120000Z");
    expect(text).toContain("LAST-MODIFIED:20260101T080000Z");
    expect(text).toContain("UID:task-t2@sigwald");
    expect(text).toContain("CATEGORIES:Sigwald task");
  });

  it("emits all-day DATE values with exclusive end, from the stored local midnight", () => {
    const event: PlanEvent = {
      id: "e1",
      title: "Holiday",
      description: null,
      location: "Office",
      // How createAllDayDate stores all-day rows: local midnight of the day.
      start: new Date(2026, 5, 19),
      end: new Date(2026, 5, 20),
      allDay: true,
    };
    const text = buildPlanCalendar({ tasks: [], events: [event], now });
    expect(text).toContain("DTSTART;VALUE=DATE:20260619");
    expect(text).toContain("DTEND;VALUE=DATE:20260620");
    expect(text).toContain("UID:event-e1@sigwald");
    expect(text).toContain("LOCATION:Office");
    expect(() => ICAL.parse(text)).not.toThrow();
  });

  it("parses with ical.js for a mix of tasks and events", () => {
    const task: PlanTask = {
      id: "mix-task",
      title: "Write",
      description: "Draft",
      scheduledStart: new Date(Date.UTC(2026, 10, 8, 13, 0, 0)),
      scheduledEnd: new Date(Date.UTC(2026, 10, 8, 14, 0, 0)),
      updatedAt: now,
    };
    const event: PlanEvent = {
      id: "mix-event",
      title: "Shift",
      description: "Ops",
      location: null,
      start: new Date(Date.UTC(2026, 10, 9, 16, 0, 0)),
      end: new Date(Date.UTC(2026, 10, 9, 20, 0, 0)),
      allDay: false,
    };
    const text = buildPlanCalendar({ tasks: [task], events: [event], now });
    const jcal = ICAL.parse(text);
    expect(jcal[0]).toBe("vcalendar");
  });
});
