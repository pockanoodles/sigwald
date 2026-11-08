import { wordDay, wordDue, wordMoment } from "@/lib/search/when";

const NY = "America/New_York";
// Sunday Nov 8 2026, 11:30 PM in New York (already Monday in UTC).
const now = new Date("2026-11-09T04:30:00Z");
const q = { now, timeZone: NY, timeFormat: "12h" as const, text: "x" };

describe("wordDay", () => {
  it("counts days where the person is, not in UTC", () => {
    expect(wordDay("2026-11-08", q)).toBe("Today");
    expect(wordDay("2026-11-09", q)).toBe("Tomorrow");
    expect(wordDay("2026-11-07", q)).toBe("Yesterday");
  });

  it("names a weekday within the week ahead, then a date", () => {
    expect(wordDay("2026-11-14", q)).toBe("Saturday");
    expect(wordDay("2026-11-15", q)).toBe("Nov 15");
    expect(wordDay("2026-11-01", q)).toBe("Nov 1");
  });

  it("adds the year when it isn't this one", () => {
    expect(wordDay("2027-01-04", q)).toBe("Jan 4, 2027");
  });
});

describe("wordMoment", () => {
  it("words the day and the time in the person's clock", () => {
    const at = new Date("2026-11-09T22:30:00Z"); // 5:30 PM Monday in NY
    expect(wordMoment(at, q)).toBe("Tomorrow 5:30 PM");
    expect(wordMoment(at, { ...q, timeFormat: "24h" })).toBe("Tomorrow 17:30");
  });
});

describe("wordDue", () => {
  it("lowercases only the relative words", () => {
    expect(wordDue("2026-11-08", q)).toBe("Due today");
    expect(wordDue("2026-11-07", q)).toBe("Due yesterday");
    expect(wordDue("2026-10-27", q)).toBe("Due Oct 27");
    expect(wordDue("2026-11-14", q)).toBe("Due Saturday");
  });
});
