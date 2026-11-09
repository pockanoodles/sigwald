import {
  parsePlans,
  planGoal,
  planKey,
  type GoalPlan,
  type PlanTaskRow,
  type Subgoal,
} from "../sigwald/goal-plans";

const GOAL = "venture:mahoraga";

const subgoal = (overrides: Partial<Subgoal> = {}): Subgoal => ({
  key: "launch",
  title: "launch",
  metric: "installs from a clean shell",
  state: "open",
  items: [
    { key: "confirm-the-pypi-name", title: "Confirm the PyPI name", done: false },
    { key: "pick-a-sponsor-platform", title: "Pick a sponsor platform", done: false },
  ],
  ...overrides,
});

const plan = (subgoals: Subgoal[]): GoalPlan => ({ goal: GOAL, path: "goals/mahoraga/overview.md", subgoals });

const row = (overrides: Partial<PlanTaskRow> & Pick<PlanTaskRow, "id" | "externalTaskId">): PlanTaskRow => ({
  title: "Launch",
  description: null,
  status: "todo",
  closedAt: null,
  parentTaskId: null,
  ...overrides,
});

/** The tasks a first run makes, as rows. */
function seeded(): PlanTaskRow[] {
  const ops = planGoal(plan([subgoal()]), []);
  const parent = ops.find((o) => o.op === "createSubgoal")!;
  if (parent.op !== "createSubgoal") throw new Error();
  return [
    row({ id: "p", externalTaskId: parent.key, title: parent.title, description: parent.description }),
    ...ops.flatMap((o) =>
      o.op === "createItem" ? [row({ id: o.key, externalTaskId: o.key, title: o.title, parentTaskId: "p" })] : []
    ),
  ];
}

describe("planGoal", () => {
  it("makes one task per open subgoal, its checklist as subtasks", () => {
    const ops = planGoal(plan([subgoal()]), []);
    expect(ops.map((o) => o.op)).toEqual(["createSubgoal", "createItem", "createItem"]);
    expect(ops[0]).toMatchObject({ key: planKey(GOAL, "launch"), title: "Launch", goal: GOAL });
    expect(ops[1]).toMatchObject({ key: planKey(GOAL, "launch", "confirm-the-pypi-name"), order: 0, done: false });
  });

  it("changes nothing when the plan hasn't changed", () => {
    expect(planGoal(plan([subgoal()]), seeded())).toEqual([]);
  });

  it("completes a subtask whose item was checked, and adds a new item", () => {
    const items = [
      { key: "confirm-the-pypi-name", title: "Confirm the PyPI name", done: true },
      { key: "pick-a-sponsor-platform", title: "Pick a sponsor platform", done: false },
      { key: "write-the-post", title: "Write the post", done: false },
    ];
    const ops = planGoal(plan([subgoal({ items })]), seeded());
    expect(ops).toEqual([
      { op: "completeItem", id: planKey(GOAL, "launch", "confirm-the-pypi-name") },
      expect.objectContaining({ op: "createItem", key: planKey(GOAL, "launch", "write-the-post"), order: 2 }),
    ]);
  });

  it("deletes an open subtask whose line left the checklist, but keeps a done one", () => {
    const rows = seeded().map((r) =>
      r.externalTaskId.endsWith("confirm-the-pypi-name") ? { ...r, status: "completed" } : r
    );
    const ops = planGoal(plan([subgoal({ items: [] })]), rows);
    expect(ops).toEqual([{ op: "deleteItem", id: planKey(GOAL, "launch", "pick-a-sponsor-platform") }]);
  });

  it("completes an achieved subgoal, closes a parked one, and never seeds either", () => {
    expect(planGoal(plan([subgoal({ state: "achieved" })]), seeded())).toEqual([{ op: "completeSubgoal", id: "p" }]);
    expect(planGoal(plan([subgoal({ state: "parked" })]), seeded())).toEqual([{ op: "closeSubgoal", id: "p" }]);
    expect(planGoal(plan([subgoal({ state: "achieved" }), subgoal({ key: "old", state: "superseded" })]), [])).toEqual([]);
  });

  it("closes a subgoal the vault no longer lists, and reopens it when it returns", () => {
    expect(planGoal(plan([]), seeded())).toEqual([{ op: "closeSubgoal", id: "p" }]);
    const closed = seeded().map((r) => (r.id === "p" ? { ...r, closedAt: new Date() } : r));
    expect(planGoal(plan([subgoal()]), closed)).toEqual([{ op: "reopenSubgoal", id: "p" }]);
  });

  it("leaves work done in Sigwald done while the vault catches up", () => {
    const done = seeded().map((r) => ({ ...r, status: "completed" }));
    expect(planGoal(plan([subgoal()]), done)).toEqual([]);
  });
});

describe("parsePlans", () => {
  const body = (sub: Record<string, unknown> = {}) => ({
    goals: [{ goal: GOAL, path: "goals/mahoraga/overview.md", subgoals: [{ ...subgoal(), ...sub }] }],
  });

  it("reads a goal's subgoals", () => {
    const plans = parsePlans(body());
    if (typeof plans === "string") throw new Error(plans);
    expect(plans[0].subgoals[0]).toMatchObject({ key: "launch", state: "open", metric: "installs from a clean shell" });
  });

  it("refuses what it can't key or place", () => {
    expect(parsePlans({ goals: [{ goal: "mahoraga", subgoals: [] }] })).toMatch(/venture:<slug>/);
    expect(parsePlans(body({ key: "Launch!" }))).toMatch(/key/);
    expect(parsePlans(body({ state: "someday" }))).toMatch(/state/);
    expect(
      parsePlans(body({ items: [{ key: "a", title: "A", done: false }, { key: "a", title: "A again", done: false }] }))
    ).toMatch(/repeats a/);
  });
});
