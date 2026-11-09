import {
  type TaskForRanking,
  computeStage1Scores,
  computeUrgencyTier,
  deadlinePressure,
  deferralHides,
  effectiveImpact,
  effectiveLift,
  effortFit,
  filterTasksForRanking,
  impactWorkIsUrgent,
  isFillerCandidate,
  orderTasksStage1,
  pickTopTaskStage1,
  rawImpact,
  restOf,
  skipPenalty,
  visibilityBoost,
} from "../sigwald/rank-stage1";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const HOUR = 3_600_000;

function at(offsetHours: number): Date {
  return new Date(NOW.getTime() + offsetHours * HOUR);
}

let idCounter = 0;
function makeTask(overrides: Partial<TaskForRanking> = {}): TaskForRanking {
  idCounter += 1;
  return {
    id: `task-${idCounter}`,
    title: `Task ${idCounter}`,
    status: "todo",
    dueDate: null,
    unlockAt: null,
    lockAt: null,
    duration: 30,
    impact: null,
    closedAt: null,
    priority: null,
    skipCount: 0,
    lastSkippedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    postponedUntil: null,
    lift: null,
    ...overrides,
  };
}

describe("deadlinePressure", () => {
  test("no due date returns 0", () => {
    expect(deadlinePressure(makeTask({ dueDate: null }), NOW)).toBe(0);
  });

  test("overdue returns 1", () => {
    expect(deadlinePressure(makeTask({ dueDate: at(-5) }), NOW)).toBe(1);
  });

  test("late-but-before-lock stays at max", () => {
    const task = makeTask({ dueDate: at(-5), lockAt: at(10) });
    expect(deadlinePressure(task, NOW)).toBe(1);
  });

  test("midpoint (48h out) is 0.5", () => {
    expect(deadlinePressure(makeTask({ dueDate: at(48) }), NOW)).toBeCloseTo(
      0.5,
      5
    );
  });

  test("far future approaches 0", () => {
    expect(deadlinePressure(makeTask({ dueDate: at(300) }), NOW)).toBeLessThan(
      0.001
    );
  });

  test("monotonic: sooner deadline is more pressing", () => {
    const soon = deadlinePressure(makeTask({ dueDate: at(12) }), NOW);
    const later = deadlinePressure(makeTask({ dueDate: at(96) }), NOW);
    expect(soon).toBeGreaterThan(later);
  });
});

describe("effectiveImpact", () => {
  test("null impact is 0", () => {
    expect(effectiveImpact(makeTask({ impact: null }), NOW)).toBe(0);
  });

  test("no due date returns raw impact", () => {
    expect(effectiveImpact(makeTask({ impact: 0.8, dueDate: null }), NOW)).toBe(
      0.8
    );
  });

  test("before due date returns raw impact", () => {
    expect(
      effectiveImpact(makeTask({ impact: 0.8, dueDate: at(10) }), NOW)
    ).toBe(0.8);
  });

  test("past lock halves impact (floored at 0.05)", () => {
    const task = makeTask({
      impact: 0.8,
      dueDate: at(-120),
      lockAt: at(-24),
    });
    expect(effectiveImpact(task, NOW)).toBeCloseTo(0.4, 5);
  });

  test("late without lock applies per-day penalty", () => {
    // 2 days late → penalty 0.2 → 0.8 * 0.8 = 0.64
    const task = makeTask({ impact: 0.8, dueDate: at(-48) });
    expect(effectiveImpact(task, NOW)).toBeCloseTo(0.64, 5);
  });

  test("penalty is floored at 0.05", () => {
    const task = makeTask({ impact: 0.1, dueDate: at(-1000) });
    expect(effectiveImpact(task, NOW)).toBe(0.05);
  });
});

describe("effortFit", () => {
  test("perfect fit is 1", () => {
    expect(effortFit(60, 60)).toBe(1);
  });

  test("task half the slot", () => {
    expect(effortFit(30, 60)).toBeCloseTo(0.5, 5);
  });

  test("task twice the slot", () => {
    expect(effortFit(60, 30)).toBeCloseTo(0.5, 5);
  });

  test("clamps non-positive inputs to at least 1 minute", () => {
    expect(effortFit(0, 0)).toBe(1);
  });
});

describe("computeUrgencyTier", () => {
  test("danger flag forces DANGER", () => {
    expect(computeUrgencyTier(makeTask({ dueDate: at(200) }), NOW, true)).toBe(
      "DANGER"
    );
  });

  test("no due date is NONE", () => {
    expect(computeUrgencyTier(makeTask({ dueDate: null }), NOW, false)).toBe(
      "NONE"
    );
  });

  test("overdue is DANGER even without the flag", () => {
    expect(computeUrgencyTier(makeTask({ dueDate: at(-1) }), NOW, false)).toBe(
      "DANGER"
    );
  });

  test("within 24h is HIGH", () => {
    expect(computeUrgencyTier(makeTask({ dueDate: at(10) }), NOW, false)).toBe(
      "HIGH"
    );
  });

  test("within a week is NORMAL", () => {
    expect(computeUrgencyTier(makeTask({ dueDate: at(100) }), NOW, false)).toBe(
      "NORMAL"
    );
  });

  test("beyond a week is LOW", () => {
    expect(computeUrgencyTier(makeTask({ dueDate: at(300) }), NOW, false)).toBe(
      "LOW"
    );
  });
});

describe("effectiveLift", () => {
  test("a task nothing lifts contributes 0", () => {
    expect(effectiveLift(makeTask({ lift: null }))).toBe(0);
  });

  test("passes a 0–1 lift through", () => {
    expect(effectiveLift(makeTask({ lift: 0.9 }))).toBeCloseTo(0.9, 5);
  });

  test("clamps above 1 to 1", () => {
    expect(effectiveLift(makeTask({ lift: 1.5 }))).toBe(1);
  });

  test("clamps below 0 to 0", () => {
    expect(effectiveLift(makeTask({ lift: -0.1 }))).toBe(0);
  });
});

describe("filterTasksForRanking", () => {
  test("removes completed, closed, and still-locked tasks", () => {
    const completed = makeTask({ status: "completed" });
    // Canvas closed it without a submission: it's not done, but it's gone.
    const missed = makeTask({ closedAt: at(-2) });
    const locked = makeTask({ unlockAt: at(24) });
    const open = makeTask({ status: "todo" });

    const kept = filterTasksForRanking([completed, missed, locked, open], NOW);

    expect(kept.map((t) => t.id)).toEqual([open.id]);
  });

  test("keeps a task whose unlock time has passed", () => {
    const unlocked = makeTask({ unlockAt: at(-1) });
    expect(filterTasksForRanking([unlocked], NOW)).toHaveLength(1);
  });

  test("removes a task still deferred past now", () => {
    const deferred = makeTask({ postponedUntil: at(2) });
    expect(filterTasksForRanking([deferred], NOW)).toHaveLength(0);
  });

  test("keeps a deferred task that's due before its deferral ends", () => {
    // Later on an assignment due tonight used to hide it until after it was due.
    const dueTonight = makeTask({ postponedUntil: at(12), dueDate: at(11) });
    expect(filterTasksForRanking([dueTonight], NOW)).toHaveLength(1);
  });

  test("keeps a task whose defer time has passed", () => {
    const due = makeTask({ postponedUntil: at(-1) });
    expect(filterTasksForRanking([due], NOW)).toHaveLength(1);
  });

  test("removes subtasks so only the parent can surface", () => {
    const parent = makeTask({ id: "parent" });
    const child = makeTask({ id: "child", parentTaskId: "parent" });
    expect(
      filterTasksForRanking([parent, child], NOW).map((t) => t.id)
    ).toEqual(["parent"]);
  });
});

describe("isFillerCandidate", () => {
  test("a task nothing rides on is a filler candidate", () => {
    expect(isFillerCandidate(makeTask())).toBe(true);
  });

  test("a task its module gave an impact is not", () => {
    expect(isFillerCandidate(makeTask({ impact: 0.2 }))).toBe(false);
  });

  test("high-priority task is not a filler candidate", () => {
    expect(isFillerCandidate(makeTask({ priority: "high" }))).toBe(false);
  });

  test("a lifted task is never a filler candidate", () => {
    expect(isFillerCandidate(makeTask({ lift: 0.8 }))).toBe(false);
  });

  test("even a lift of 0 counts: a goal still vouches for it", () => {
    expect(isFillerCandidate(makeTask({ lift: 0 }))).toBe(false);
  });
});

describe("impactWorkIsUrgent", () => {
  test("true when work with impact is due within a day", () => {
    const pool = [makeTask({ impact: 0.3, dueDate: at(10) }), makeTask()];
    expect(impactWorkIsUrgent(pool, NOW)).toBe(true);
  });

  test("false when only work without impact is urgent", () => {
    const pool = [
      makeTask({ dueDate: at(2) }),
      makeTask({ impact: 0.3, dueDate: at(100) }),
    ];
    expect(impactWorkIsUrgent(pool, NOW)).toBe(false);
  });
});

describe("visibilityBoost", () => {
  // Ten assignments in one course; p80 of their points is the 8th smallest (80).
  const course = Array.from({ length: 10 }, (_, i) =>
    makeTask({ stakes: (i + 1) * 10, stakesGroup: "c1", dueDate: at(24 * 20) })
  );

  test("far-out work above its group's 80th percentile is boosted", () => {
    expect(visibilityBoost(course[9], course, NOW)).toBeCloseTo(0.15, 6);
    expect(visibilityBoost(course[8], course, NOW)).toBeCloseTo(0.15, 6);
  });

  test("work at or below the 80th percentile is not", () => {
    expect(visibilityBoost(course[7], course, NOW)).toBe(0);
    expect(visibilityBoost(course[0], course, NOW)).toBe(0);
  });

  test("nothing within a week, nothing without a due date or stakes", () => {
    const soon = makeTask({
      stakes: 500,
      stakesGroup: "c1",
      dueDate: at(24 * 6),
    });
    const undated = makeTask({ stakes: 500, stakesGroup: "c1", dueDate: null });
    const plain = makeTask({ dueDate: at(24 * 20) });
    expect(visibilityBoost(soon, [...course, soon], NOW)).toBe(0);
    expect(visibilityBoost(undated, [...course, undated], NOW)).toBe(0);
    expect(visibilityBoost(plain, [...course, plain], NOW)).toBe(0);
  });

  test("stakes compare only within their group", () => {
    // 200 points tops another course's list, but not this one's.
    const other = makeTask({
      stakes: 200,
      stakesGroup: "c2",
      dueDate: at(24 * 20),
    });
    const big = Array.from({ length: 5 }, () =>
      makeTask({ stakes: 300, stakesGroup: "c2", dueDate: at(24 * 20) })
    );
    expect(visibilityBoost(other, [...course, other, ...big], NOW)).toBe(0);
    const alone = makeTask({
      stakes: 100,
      stakesGroup: "c3",
      dueDate: at(24 * 20),
    });
    // Alone in its group, it is its own 80th percentile.
    expect(visibilityBoost(alone, [...course, alone], NOW)).toBe(0);
  });
});

describe("computeStage1Scores", () => {
  test("base score blends impact, deadline pressure, and effort fit", () => {
    const task = makeTask({ dueDate: null, duration: 240 });
    const norm = new Map([[task.id, 1]]);
    // dp = 0 (no due date), ef = effortFit(240, 240) = 1, impact = 1
    // base = 0.35*1 + 0.45*0 + 0.2*1 = 0.55
    const scores = computeStage1Scores(task, [task], NOW, 240, norm);
    expect(scores.baseScore).toBeCloseTo(0.55, 5);
    expect(scores.urgencyTier).toBe("NONE");
    expect(scores.danger).toBe(false);
    expect(scores.fillerDemoted).toBe(false);
  });

  test("filler is demoted when work with impact is urgent", () => {
    const courseworkUrgent = makeTask({ impact: 0.5, dueDate: at(10) });
    const personal = makeTask({ dueDate: at(100) });
    const pool = [courseworkUrgent, personal];
    const norm = new Map(pool.map((t) => [t.id, 0.5]));

    const personalScores = computeStage1Scores(personal, pool, NOW, null, norm);
    expect(personalScores.fillerDemoted).toBe(true);
  });

  test("a lifted personal task is not demoted alongside urgent coursework", () => {
    const courseworkUrgent = makeTask({ impact: 0.5, dueDate: at(10) });
    const goalPersonal = makeTask({ dueDate: at(100), lift: 0.8 });
    const pool = [courseworkUrgent, goalPersonal];
    const norm = new Map(pool.map((t) => [t.id, 0.5]));

    const goalScores = computeStage1Scores(goalPersonal, pool, NOW, null, norm);
    expect(goalScores.fillerDemoted).toBe(false);
  });
});

describe("orderTasksStage1 — lift path", () => {
  test("a task lifted by an important goal outranks low-impact coursework", () => {
    const courseworkLow = makeTask({ impact: 0.1, dueDate: at(100) });
    const goalTask = makeTask({ lift: 0.9, dueDate: at(100) });

    const ordered = orderTasksStage1([courseworkLow, goalTask], NOW, {
      slotMinutes: null,
    });

    expect(ordered[0].id).toBe(goalTask.id);
    expect(ordered[1].id).toBe(courseworkLow.id);
  });

  test("a lifted personal task ranks ahead of a demoted plain one", () => {
    const courseworkUrgent = makeTask({ impact: 0.5, dueDate: at(10) });
    const goalPersonal = makeTask({ lift: 0.8, dueDate: at(100) });
    const plainPersonal = makeTask({ dueDate: at(100) });

    const ordered = orderTasksStage1(
      [courseworkUrgent, goalPersonal, plainPersonal],
      NOW,
      { slotMinutes: null }
    );

    const goalIdx = ordered.findIndex((t) => t.id === goalPersonal.id);
    const plainIdx = ordered.findIndex((t) => t.id === plainPersonal.id);
    // Plain personal is demoted to the filler lane (last); the goal-linked one is not.
    expect(plainIdx).toBe(ordered.length - 1);
    expect(goalIdx).toBeLessThan(plainIdx);
  });

  test("empty input yields empty output", () => {
    expect(orderTasksStage1([], NOW, { slotMinutes: null })).toEqual([]);
  });
});

describe("pickTopTaskStage1", () => {
  test("filters out completed tasks before picking the top", () => {
    const completed = makeTask({ status: "completed", dueDate: at(1) });
    const goalTask = makeTask({ lift: 0.95, dueDate: at(100) });

    const top = pickTopTaskStage1([completed, goalTask], NOW, {
      slotMinutes: null,
    });

    expect(top?.id).toBe(goalTask.id);
  });

  test("returns null when nothing is eligible", () => {
    const completed = makeTask({ status: "completed" });
    expect(
      pickTopTaskStage1([completed], NOW, { slotMinutes: null })
    ).toBeNull();
  });
});

describe("skip cooldown", () => {
  test("a task not skipped never rests and takes no penalty", () => {
    const task = makeTask({ skipCount: 3, lastSkippedAt: null });
    expect(restOf(task, NOW)).toBeNull();
    expect(skipPenalty(task, NOW)).toBe(0);
  });

  test("rests inside the window, not after it", () => {
    expect(restOf(makeTask({ lastSkippedAt: at(-1) }), NOW)).toEqual({
      reason: "skipped",
      until: at(3),
    });
    expect(restOf(makeTask({ lastSkippedAt: at(-3.9) }), NOW)).not.toBeNull();
    expect(restOf(makeTask({ lastSkippedAt: at(-4.1) }), NOW)).toBeNull();
  });

  test("a future lastSkippedAt (clock skew) still counts as just skipped", () => {
    expect(restOf(makeTask({ lastSkippedAt: at(2) }), NOW)?.until).toEqual(
      at(4)
    );
  });

  test("penalty grows with skip count and halves every 48h", () => {
    const once = makeTask({ skipCount: 1, lastSkippedAt: NOW });
    const thrice = makeTask({ skipCount: 3, lastSkippedAt: NOW });
    expect(skipPenalty(once, NOW)).toBeCloseTo(0.05, 6);
    expect(skipPenalty(thrice, NOW)).toBeCloseTo(0.15, 6);
    // Capped at 0.2 however many times it's been skipped.
    expect(skipPenalty(makeTask({ skipCount: 20, lastSkippedAt: NOW }), NOW)) //
      .toBeCloseTo(0.2, 6);
    expect(
      skipPenalty(makeTask({ skipCount: 3, lastSkippedAt: at(-48) }), NOW)
    ).toBeCloseTo(0.075, 6);
  });

  test("the skipped task loses the lead even when it is the DANGER one", () => {
    // This is the bug: the top task is top *because* it is urgent, so a
    // score-only penalty would leave it at #1 and Skip would do nothing.
    const overdue = makeTask({
      dueDate: at(-10),
      impact: 0.9,
      lastSkippedAt: at(-0.01),
      skipCount: 1,
    });
    const calm = makeTask({ dueDate: at(72), impact: 0.1 });

    const ordered = orderTasksStage1([overdue, calm], NOW, {
      slotMinutes: null,
    });
    expect(ordered.map((t) => t.id)).toEqual([calm.id, overdue.id]);
  });

  test("it returns to the lead once the cooldown lapses", () => {
    const overdue = makeTask({
      dueDate: at(-10),
      impact: 0.9,
      lastSkippedAt: at(-5),
      skipCount: 1,
    });
    const calm = makeTask({ dueDate: at(72), impact: 0.1 });

    const ordered = orderTasksStage1([overdue, calm], NOW, {
      slotMinutes: null,
    });
    expect(ordered[0]?.id).toBe(overdue.id);
  });

  test("cooling is a sort key, not a filter — Focus never runs dry", () => {
    const only = makeTask({ dueDate: at(1), lastSkippedAt: NOW, skipCount: 1 });
    expect(pickTopTaskStage1([only], NOW, { slotMinutes: null })?.id).toBe(
      only.id
    );
  });

  test("between two cooling tasks the normal ordering still decides", () => {
    const urgent = makeTask({
      dueDate: at(-10),
      impact: 0.9,
      lastSkippedAt: NOW,
      skipCount: 1,
    });
    const calm = makeTask({
      dueDate: at(72),
      impact: 0.1,
      lastSkippedAt: NOW,
      skipCount: 1,
    });

    const ordered = orderTasksStage1([calm, urgent], NOW, {
      slotMinutes: null,
    });
    expect(ordered[0]?.id).toBe(urgent.id);
  });
});

describe("rests never run past a deadline", () => {
  test("a skip ends effort plus an hour before the task is due", () => {
    // Due in 3 h, 30 min of work: back at +1.5 h, not +4 h.
    const task = makeTask({ dueDate: at(3), duration: 30, lastSkippedAt: NOW });
    expect(restOf(task, NOW)).toEqual({ reason: "skipped", until: at(1.5) });
  });

  test("a Later ends before the deadline too", () => {
    // "Later" stamps the end of the day; the assignment is due an hour before that.
    const task = makeTask({
      dueDate: at(11),
      duration: 60,
      postponedUntil: at(12),
    });
    expect(restOf(task, NOW)).toEqual({ reason: "later", until: at(9) });
  });

  test("inside that window there's nothing left to put off", () => {
    const dueSoon = makeTask({
      dueDate: at(1),
      duration: 30,
      lastSkippedAt: NOW,
    });
    expect(restOf(dueSoon, NOW)).toBeNull();
    const calm = makeTask({ dueDate: at(72) });
    expect(
      orderTasksStage1([calm, dueSoon], NOW, { slotMinutes: null })[0]?.id
    ).toBe(dueSoon.id);
  });

  test("overdue work still rests when skipped: there's no deadline left to protect", () => {
    const overdue = makeTask({ dueDate: at(-10), lastSkippedAt: NOW });
    expect(restOf(overdue, NOW)?.reason).toBe("skipped");
  });

  test("a skip and a Later together rest until the later of the two", () => {
    const task = makeTask({ lastSkippedAt: NOW, postponedUntil: at(8) });
    expect(restOf(task, NOW)).toEqual({ reason: "later", until: at(8) });
  });
});

describe("deferralHides", () => {
  test("hides a deferred task with no deadline, or one due after the deferral", () => {
    expect(deferralHides(makeTask({ postponedUntil: at(5) }), NOW)).toBe(true);
    expect(
      deferralHides(makeTask({ postponedUntil: at(5), dueDate: at(30) }), NOW)
    ).toBe(true);
  });

  test("never hides a task due before the deferral ends, overdue included", () => {
    expect(
      deferralHides(makeTask({ postponedUntil: at(12), dueDate: at(11) }), NOW)
    ).toBe(false);
    expect(
      deferralHides(makeTask({ postponedUntil: at(12), dueDate: at(-2) }), NOW)
    ).toBe(false);
  });

  test("a deferral that's over hides nothing", () => {
    expect(deferralHides(makeTask({ postponedUntil: at(-1) }), NOW)).toBe(
      false
    );
  });
});

describe("the full list (Today)", () => {
  test("keeps a resting task in its place instead of sinking it", () => {
    const urgent = makeTask({
      dueDate: at(-10),
      impact: 0.9,
      lastSkippedAt: NOW,
      skipCount: 1,
    });
    const calm = makeTask({ dueDate: at(72), impact: 0.1 });
    const next = orderTasksStage1([urgent, calm], NOW, { slotMinutes: null });
    const full = orderTasksStage1([urgent, calm], NOW, {
      slotMinutes: null,
      restingLast: false,
    });
    expect(next.map((t) => t.id)).toEqual([calm.id, urgent.id]);
    expect(full.map((t) => t.id)).toEqual([urgent.id, calm.id]);
  });
});

describe("rawImpact — the person's stated priority", () => {
  it("lifts a high task with nothing else behind it to a sizable assignment's weight", () => {
    expect(rawImpact(makeTask({ priority: "high" }), NOW)).toBe(0.7);
    // A stronger reason still wins.
    expect(rawImpact(makeTask({ priority: "high", impact: 0.9 }), NOW)).toBe(0.9);
  });

  it("caps a low task, whatever its source or goal says", () => {
    expect(rawImpact(makeTask({ priority: "low", impact: 0.9 }), NOW)).toBe(0.15);
    expect(rawImpact(makeTask({ priority: "low", lift: 0.95 }), NOW)).toBe(0.15);
  });

  it("leaves medium alone: it's what the modules give every task", () => {
    expect(rawImpact(makeTask({ priority: "medium", impact: 0.3 }), NOW)).toBe(0.3);
    expect(rawImpact(makeTask({ priority: "medium" }), NOW)).toBe(0);
  });

  it("puts a hand-made high task ahead of an equally due one nothing vouches for", () => {
    const high = makeTask({ priority: "high", dueDate: at(30) });
    const plain = makeTask({ dueDate: at(30) });
    const graded = makeTask({ impact: 0.5, dueDate: at(30) });
    const order = orderTasksStage1([plain, graded, high], NOW, { slotMinutes: null }).map((t) => t.id);
    expect(order.indexOf(high.id)).toBeLessThan(order.indexOf(graded.id));
    expect(order.indexOf(graded.id)).toBeLessThan(order.indexOf(plain.id));
  });
});
