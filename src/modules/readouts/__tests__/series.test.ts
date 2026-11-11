import { type ReadingRow, buildReadouts } from "@/modules/readouts/series";

const row = (
  module: string,
  name: string,
  day: string,
  value: number
): ReadingRow => ({
  module,
  key: name,
  label: name,
  unit: "count",
  day,
  value,
  at: `${day}T12:00:00.000Z`,
});

describe("buildReadouts", () => {
  it("gives each number where it stands and how it moved over 1, 7 and 30 days", () => {
    const [subs] = buildReadouts(
      [
        row("youtube", "subs", "2026-10-01", 900),
        row("youtube", "subs", "2026-11-03", 980),
        row("youtube", "subs", "2026-11-10", 1000),
        row("youtube", "subs", "2026-11-11", 1012),
      ],
      ["youtube"]
    );
    expect(subs).toMatchObject({
      value: 1012,
      day: "2026-11-11",
      change: { day1: 12, day7: 32, day30: 112 },
    });
    expect(subs.history.map((h) => h.day)).toEqual([
      "2026-10-01",
      "2026-11-03",
      "2026-11-10",
      "2026-11-11",
    ]);
  });

  it("says nothing about a change it has no earlier reading for", () => {
    const [only] = buildReadouts(
      [row("stripe", "mrr", "2026-11-11", 40)],
      ["stripe"]
    );
    expect(only.change).toEqual({ day1: null, day7: null, day30: null });
  });

  it("orders by module, then by the order the module first read its numbers", () => {
    const readouts = buildReadouts(
      [
        row("stripe", "mrr", "2026-11-11", 1),
        row("youtube", "views", "2026-11-11", 1),
        row("stripe", "balance", "2026-11-11", 1),
        row("youtube", "subs", "2026-11-11", 1),
      ],
      ["youtube", "stripe"]
    );
    expect(readouts.map((r) => `${r.module}.${r.label}`)).toEqual([
      "youtube.views",
      "youtube.subs",
      "stripe.mrr",
      "stripe.balance",
    ]);
  });
});
