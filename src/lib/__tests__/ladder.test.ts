import { buildLadder, type LadderGoalRow, type LadderInput } from "../sigwald/ladder";

const goal = (row: Partial<LadderGoalRow> & Pick<LadderGoalRow, "id" | "title">): LadderGoalRow => ({
  isBoss: false,
  status: "active",
  develops: [],
  parentIds: [],
  day: null,
  updatedDay: "2026-09-01",
  targetDate: null,
  externalId: null,
  importanceScore: 50,
  taskSources: [],
  cycleId: "hex5",
  whyItMatters: null,
  definitionOfDone: null,
  proof: null,
  ...row,
});

const input = (hex: LadderInput["hex"]): LadderInput => ({
  today: "2026-10-24",
  hex,
  currentCycleId: "hex5",
  goals: [
    goal({ id: "school", title: "School", develops: ["intelligence", "mind"], externalId: "venture:school-f25" }),
    goal({ id: "gym", title: "Gym", develops: ["vigor", "strength"] }),
    goal({ id: "exam1", title: "Exam 1", isBoss: true, parentIds: ["school"], day: "2026-10-09" }),
    goal({ id: "quiz", title: "Quiz", isBoss: true, parentIds: ["school"], day: "2026-10-15", status: "done" }),
    goal({ id: "exam2", title: "Exam 2", isBoss: true, parentIds: ["school"], day: "2026-11-03" }),
  ],
  done: [
    { id: "t1", title: "Essay", day: "2026-10-01", course: "SCHM2301", goalIds: ["school"] },
    { id: "t2", title: "Lab", day: "2026-10-02", course: null, goalIds: ["school"] },
    { id: "t3", title: "Summer reading", day: "2026-08-20", course: null, goalIds: ["school"] },
    { id: "t4", title: "Errand", day: "2026-10-05", course: null, goalIds: [] },
  ],
  open: [
    { id: "o1", goalIds: ["school"] },
    { id: "o2", goalIds: ["exam2"] },
    { id: "o3", goalIds: [] },
  ],
  cycles: [
    { id: "hex5", theme: "Employment arc", focusStats: ["arcane", "intelligence"], buildProjected: true, first: "2026-09-01" },
    { id: "hex4", theme: "", focusStats: ["intelligence", "vigor"], buildProjected: false, first: "2026-07-01" },
  ],
});

describe("buildLadder — the running hex", () => {
  const ladder = buildLadder(input({ year: 2026, index: 5 }));
  const stat = (key: string) => ladder.stats.find((s) => s.key === key)!;

  it("places today inside the hex", () => {
    expect(ladder.hex).toMatchObject({ state: "current", first: "2026-09-01", last: "2026-10-31", days: 61, elapsed: 54 });
    expect(ladder.hex.build).toEqual(["arcane", "intelligence"]);
    expect(ladder.hex.buildProjected).toBe(true);
  });

  it("counts the hex's work and the felled boss, and keeps lifetime from earlier hexes", () => {
    expect(stat("intelligence")).toMatchObject({ gained: 3.5, xp: 4, level: 2 });
    expect(ladder.summary).toMatchObject({ done: 3, unlinked: 1, gained: 7, xp: 8, buildShare: 0.5 });
  });

  it("flags a Build stat no goal develops", () => {
    expect(stat("arcane").flag).toBe("starved");
    expect(stat("intelligence").flag).toBeNull();
    expect(stat("vigor")).toMatchObject({ build: false, flag: null, feeders: ["gym"] });
  });

  it("credits goals, counts open work through bosses, and names the next boss", () => {
    expect(ladder.goals.map((g) => g.id)).toEqual(["school", "gym"]);
    expect(ladder.goals[0]).toMatchObject({
      xp: 7,
      done: 2,
      open: 2,
      managed: true,
      nextBoss: { title: "Exam 2", day: "2026-11-03" },
    });
    expect(ladder.nextBoss?.title).toBe("Exam 2");
  });

  it("puts the hex's bosses on its track, felled or not", () => {
    expect(ladder.bosses.map((b) => [b.title, b.felled, b.goalTitle])).toEqual([
      ["Exam 1", false, "School"],
      ["Quiz", true, "School"],
    ]);
  });

  it("lays out every day and logs the newest first", () => {
    expect(ladder.days).toHaveLength(61);
    expect(ladder.days.find((d) => d.day === "2026-10-15")).toEqual({ day: "2026-10-15", done: 0, xp: 5 });
    expect(ladder.events.map((e) => e.id)).toEqual(["quiz", "t4", "t2", "t1"]);
    expect(ladder.events.find((e) => e.id === "t4")?.lost).toBe(1);
  });

  it("sums each hex of the year", () => {
    expect(ladder.year[3]).toMatchObject({ months: "Jul–Aug", state: "past", xp: 1, done: 1, build: ["intelligence", "vigor"] });
    expect(ladder.year[4]).toMatchObject({ state: "current", xp: 7, done: 3 });
    expect(ladder.year[5]).toMatchObject({ state: "future", xp: 0 });
  });
});

describe("buildLadder — other hexes", () => {
  it("shows a finished hex as its sheet stood on its last day", () => {
    const ladder = buildLadder(input({ year: 2026, index: 4 }));
    expect(ladder.hex).toMatchObject({
      state: "past",
      build: ["intelligence", "vigor"],
      buildProjected: false,
      inheritedFrom: null,
    });
    expect(ladder.stats.find((s) => s.key === "intelligence")).toMatchObject({ xp: 0.5, gained: 0.5 });
    expect(ladder.goals.map((g) => [g.id, g.done])).toEqual([["school", 1]]);
  });

  it("shows the running hex's goals in one that hasn't begun, and nothing earned", () => {
    const ladder = buildLadder(input({ year: 2026, index: 6 }));
    expect(ladder.hex).toMatchObject({
      state: "future",
      elapsed: 0,
      cycleId: null,
      build: ["arcane", "intelligence"],
      buildProjected: true,
      inheritedFrom: "Sep–Oct",
    });
    expect(ladder.goals.map((g) => g.id)).toEqual(["school", "gym"]);
    expect(ladder.summary.gained).toBe(0);
    expect(ladder.bosses.map((b) => b.title)).toEqual(["Exam 2"]);
  });

  it("says what proved each boss, and that a boss felled by hand was marked", () => {
    const base = input({ year: 2026, index: 5 });
    const graded = { source: "canvas" as const, state: "done" as const, label: "Graded 90 / 100" };
    const waiting = { source: "canvas" as const, state: "open" as const, label: "Waiting on a grade" };
    const ladder = buildLadder({
      ...base,
      goals: base.goals.map((g) =>
        g.id === "quiz" ? { ...g, proof: graded } : g.id === "exam1" ? { ...g, proof: waiting, status: "done" } : g
      ),
    });
    expect(ladder.bosses.map((b) => [b.title, b.proof.label])).toEqual([
      ["Exam 1", "Marked done"],
      ["Quiz", "Graded 90 / 100"],
    ]);
    expect(ladder.events.find((e) => e.id === "quiz")?.proof).toBe("Graded 90 / 100");
    expect(buildLadder(input({ year: 2026, index: 6 })).nextBoss?.proof).toEqual({
      source: null,
      state: "open",
      label: "You mark it",
    });
  });

  it("shows a goal set aside only where its work earned XP, and never as a feeder", () => {
    const base = input({ year: 2026, index: 5 });
    const ladder = buildLadder({
      ...base,
      goals: base.goals.map((g) => (g.id === "school" || g.id === "gym" ? { ...g, status: "dropped" } : g)),
    });
    // School's finished work earned XP this hex, so it stays; Gym's didn't.
    expect(ladder.goals.map((g) => [g.id, g.status])).toEqual([["school", "dropped"]]);
    expect(ladder.stats.find((s) => s.key === "intelligence")).toMatchObject({ gained: 3.5, feeders: [] });
  });

  it("drops a boss set aside from the track", () => {
    const base = input({ year: 2026, index: 5 });
    const ladder = buildLadder({
      ...base,
      goals: base.goals.map((g) => (g.id === "exam1" ? { ...g, status: "dropped" } : g)),
    });
    expect(ladder.bosses.map((b) => b.title)).toEqual(["Quiz"]);
  });

  it("gives a boss made at the top level its own row", () => {
    const base = input({ year: 2026, index: 5 });
    const ladder = buildLadder({
      ...base,
      goals: [...base.goals, goal({ id: "solo", title: "Marathon", isBoss: true, develops: ["vigor"], day: "2026-10-20" })],
    });
    expect(ladder.goals.find((g) => g.id === "solo")).toMatchObject({ isBoss: true, stats: ["vigor"] });
  });
});
