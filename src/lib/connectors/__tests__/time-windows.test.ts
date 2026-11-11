import {
  hoursWithin,
  mondayOf,
  windowsFor,
} from "@/lib/connectors/time-windows";

describe("time windows", () => {
  it("starts the week on Monday", () => {
    expect(mondayOf("2026-11-11")).toBe("2026-11-09"); // a Wednesday
    expect(mondayOf("2026-11-09")).toBe("2026-11-09"); // a Monday
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // a Sunday
  });

  it("takes today and this week in the person's zone, not the server's", () => {
    // 02:00 UTC Wednesday is still Tuesday evening in New York.
    const w = windowsFor(
      new Date("2026-11-11T02:00:00.000Z"),
      "America/New_York"
    );
    expect(w.today.from.toISOString()).toBe("2026-11-10T05:00:00.000Z");
    expect(w.today.to.toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(w.week.from.toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });

  it("counts a week that crosses a daylight-saving change by the clock's real hours", () => {
    // New York falls back on 2026-11-01: that Sunday has 25 hours.
    const w = windowsFor(
      new Date("2026-11-01T18:00:00.000Z"),
      "America/New_York"
    );
    expect((w.today.to.getTime() - w.today.from.getTime()) / 3_600_000).toBe(
      25
    );
  });

  it("counts only the part of an entry inside the window, so one past midnight splits", () => {
    const window = {
      from: new Date("2026-11-11T05:00:00Z"),
      to: new Date("2026-11-12T05:00:00Z"),
    };
    expect(
      hoursWithin(
        new Date("2026-11-11T03:00:00Z"),
        new Date("2026-11-11T07:30:00Z"),
        window
      )
    ).toBe(2.5);
    expect(
      hoursWithin(
        new Date("2026-11-10T01:00:00Z"),
        new Date("2026-11-10T02:00:00Z"),
        window
      )
    ).toBe(0);
  });
});
