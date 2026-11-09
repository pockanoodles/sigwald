/**
 * A goal's plan as work Focus can rank: each subgoal the vault lists becomes
 * one task under its goal, with the subgoal's checklist as that task's
 * subtasks. ops' pump 7 sends every active goal's subgoals each morning
 * (PUT /api/sigwald/goals/plans), after it projects the goals themselves.
 *
 * Until this, a goal's plan lived only in the vault, and the vault kept
 * undated work out of Sigwald, so Focus ranked nothing but coursework. A plan
 * task has no deadline: it ranks by its goal's importance, below anything a
 * deadline presses on, which is when goal work should come up.
 *
 * The vault is the plan, Sigwald is the doing:
 *  - a new subgoal or item is added; a renamed one is a new one;
 *  - an item checked in the vault completes its subtask, and a subgoal marked
 *    achieved completes its task (it earns its XP then);
 *  - a subgoal parked, superseded or no longer listed is closed (no XP), and
 *    reopens if it comes back;
 *  - what was done in Sigwald stays done, even while the vault still shows it
 *    open: the vault catches up, the work isn't undone.
 *  - an open subtask whose item left the checklist is deleted; it was only a
 *    copy of the line.
 *
 * Tasks carry the goal's projection id as their source ("venture:mahoraga"),
 * which the goal claims, and `plan:<goal>#<subgoal>[#<item>]` as their key.
 */
import type { Db, DbTransaction } from "@/lib/prisma";

export type SubgoalState = "open" | "achieved" | "parked" | "superseded";

export interface PlanItem {
  key: string;
  title: string;
  done: boolean;
}

export interface Subgoal {
  key: string;
  title: string;
  metric: string | null;
  state: SubgoalState;
  items: PlanItem[];
}

export interface GoalPlan {
  /** The goal's projection id: "venture:mahoraga". */
  goal: string;
  /** The goal's file in the vault, for the task's description. */
  path: string | null;
  subgoals: Subgoal[];
}

/** A plan task as the planner reads it. */
export interface PlanTaskRow {
  id: string;
  externalTaskId: string;
  title: string;
  description: string | null;
  status: string;
  closedAt: Date | null;
  parentTaskId: string | null;
}

export const planKey = (goal: string, subgoal: string, item?: string) =>
  `plan:${goal}#${subgoal}${item === undefined ? "" : `#${item}`}`;

const KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;
const GOAL = /^venture:[a-z0-9][a-z0-9-]*$/;
const STATES = new Set<SubgoalState>(["open", "achieved", "parked", "superseded"]);
const MAX_GOALS = 100;
const MAX_SUBGOALS = 50;
const MAX_ITEMS = 100;

export function subgoalDescription(plan: Pick<GoalPlan, "path">, subgoal: Pick<Subgoal, "title" | "metric">): string {
  return [
    subgoal.metric ? `Done when: ${subgoal.metric}` : null,
    `From your vault${plan.path ? `: ${plan.path}` : ""}, "Subgoal: ${subgoal.title}". Its checklist is below.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const capitalized = (title: string) => title.charAt(0).toUpperCase() + title.slice(1);

export type PlanOp =
  | { op: "createSubgoal"; key: string; title: string; description: string; goal: string }
  | { op: "updateSubgoal"; id: string; title: string; description: string }
  | { op: "completeSubgoal"; id: string }
  | { op: "closeSubgoal"; id: string }
  | { op: "reopenSubgoal"; id: string }
  | { op: "createItem"; parentKey: string; key: string; title: string; done: boolean; order: number; goal: string }
  | { op: "completeItem"; id: string }
  | { op: "updateItem"; id: string; title: string; order: number }
  | { op: "deleteItem"; id: string };

/**
 * What it takes to bring one goal's plan tasks in line with its plan. Pure:
 * `existing` is every task under the goal's plan keys.
 */
export function planGoal(plan: GoalPlan, existing: PlanTaskRow[]): PlanOp[] {
  const ops: PlanOp[] = [];
  const byKey = new Map(existing.map((t) => [t.externalTaskId, t]));
  const listed = new Set<string>();

  for (const subgoal of plan.subgoals) {
    const key = planKey(plan.goal, subgoal.key);
    listed.add(key);
    const parent = byKey.get(key);
    const title = capitalized(subgoal.title);
    const description = subgoalDescription(plan, subgoal);
    const open = parent && parent.status !== "completed" && parent.closedAt === null;

    if (subgoal.state === "achieved") {
      // An achieved subgoal never seeded doesn't need a task: XP is for work Sigwald saw.
      if (open) ops.push({ op: "completeSubgoal", id: parent.id });
      continue;
    }
    if (subgoal.state === "parked" || subgoal.state === "superseded") {
      if (open) ops.push({ op: "closeSubgoal", id: parent.id });
      continue;
    }

    if (!parent) {
      ops.push({ op: "createSubgoal", key, title, description, goal: plan.goal });
    } else {
      if (parent.closedAt !== null && parent.status !== "completed") ops.push({ op: "reopenSubgoal", id: parent.id });
      if (parent.title !== title || parent.description !== description) {
        ops.push({ op: "updateSubgoal", id: parent.id, title, description });
      }
    }

    const itemKeys = new Set<string>();
    subgoal.items.forEach((item, order) => {
      const itemKey = planKey(plan.goal, subgoal.key, item.key);
      itemKeys.add(itemKey);
      const sub = byKey.get(itemKey);
      if (!sub) {
        ops.push({ op: "createItem", parentKey: key, key: itemKey, title: item.title, done: item.done, order, goal: plan.goal });
        return;
      }
      if (item.done && sub.status !== "completed") ops.push({ op: "completeItem", id: sub.id });
      if (sub.title !== item.title) ops.push({ op: "updateItem", id: sub.id, title: item.title, order });
    });
    for (const sub of existing) {
      if (sub.parentTaskId === parent?.id && parent && !itemKeys.has(sub.externalTaskId) && sub.status !== "completed") {
        ops.push({ op: "deleteItem", id: sub.id });
      }
    }
  }

  // A subgoal the vault no longer lists: closed, not deleted (its done subtasks are history).
  for (const task of existing) {
    if (task.parentTaskId === null && !listed.has(task.externalTaskId) && task.status !== "completed" && task.closedAt === null) {
      ops.push({ op: "closeSubgoal", id: task.id });
    }
  }
  return ops;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A PUT body's plans, or what's wrong with it. */
export function parsePlans(raw: unknown): GoalPlan[] | string {
  if (!isRecord(raw) || !Array.isArray(raw.goals)) return "goals must be a list";
  if (raw.goals.length > MAX_GOALS) return `send at most ${MAX_GOALS} goals`;
  const plans: GoalPlan[] = [];
  const seenGoals = new Set<string>();
  for (const [g, entry] of raw.goals.entries()) {
    const where = `goals[${g}]`;
    if (!isRecord(entry)) return `${where} must be an object`;
    const goal = text(entry.goal, 120);
    if (!goal || !GOAL.test(goal)) return `${where}.goal must be a projection id like venture:<slug>`;
    if (seenGoals.has(goal)) return `${where} repeats ${goal}`;
    seenGoals.add(goal);
    if (!Array.isArray(entry.subgoals) || entry.subgoals.length > MAX_SUBGOALS) return `${where}.subgoals must be a list`;
    const subgoals: Subgoal[] = [];
    const seenSub = new Set<string>();
    for (const [s, sub] of entry.subgoals.entries()) {
      const at = `${where}.subgoals[${s}]`;
      if (!isRecord(sub)) return `${at} must be an object`;
      const key = text(sub.key, 80);
      const title = text(sub.title, 140);
      if (!key || !KEY.test(key) || !title) return `${at} needs a key (a-z, 0-9, -) and a title`;
      if (seenSub.has(key)) return `${at} repeats ${key}`;
      seenSub.add(key);
      if (!STATES.has(sub.state as SubgoalState)) return `${at}.state must be open, achieved, parked or superseded`;
      if (!Array.isArray(sub.items) || sub.items.length > MAX_ITEMS) return `${at}.items must be a list`;
      const items: PlanItem[] = [];
      const seenItem = new Set<string>();
      for (const [i, item] of sub.items.entries()) {
        const ia = `${at}.items[${i}]`;
        if (!isRecord(item)) return `${ia} must be an object`;
        const itemKey = text(item.key, 80);
        const itemTitle = text(item.title, 300);
        if (!itemKey || !KEY.test(itemKey) || !itemTitle) return `${ia} needs a key and a title`;
        if (seenItem.has(itemKey)) return `${ia} repeats ${itemKey}`;
        seenItem.add(itemKey);
        if (typeof item.done !== "boolean") return `${ia}.done must be true or false`;
        items.push({ key: itemKey, title: itemTitle, done: item.done });
      }
      subgoals.push({ key, title, metric: text(sub.metric, 500), state: sub.state as SubgoalState, items });
    }
    plans.push({ goal, path: text(entry.path, 200), subgoals });
  }
  return plans;
}

export interface PlansResult {
  goals: number;
  /** Goal ids the user has no goal for: the plan waits until pump 7 projects it. */
  unknownGoals: string[];
  created: number;
  completed: number;
  closed: number;
  reopened: number;
  updated: number;
  items: { created: number; completed: number; updated: number; deleted: number };
  /** Tasks made or changed, for the goal rules to file. */
  changed: string[];
}

/** Bring every listed goal's plan tasks in line with the plans sent. */
export async function applyGoalPlans(
  db: Db | DbTransaction,
  userId: string,
  plans: GoalPlan[],
  now: Date
): Promise<PlansResult> {
  const result: PlansResult = {
    goals: 0,
    unknownGoals: [],
    created: 0,
    completed: 0,
    closed: 0,
    reopened: 0,
    updated: 0,
    items: { created: 0, completed: 0, updated: 0, deleted: 0 },
    changed: [],
  };
  const known = new Set(
    (
      await db.goal.findMany({
        where: { userId, externalId: { in: plans.map((p) => p.goal) } },
        select: { externalId: true },
      })
    ).map((g) => g.externalId)
  );

  for (const plan of plans) {
    if (!known.has(plan.goal)) {
      result.unknownGoals.push(plan.goal);
      continue;
    }
    result.goals += 1;
    const existing = await db.task.findMany({
      where: { userId, externalTaskId: { startsWith: `plan:${plan.goal}#` } },
      select: { id: true, externalTaskId: true, title: true, description: true, status: true, closedAt: true, parentTaskId: true },
    });
    const parentIdByKey = new Map(
      existing.filter((t) => t.parentTaskId === null).map((t) => [t.externalTaskId as string, t.id])
    );
    const ops = planGoal(plan, existing as PlanTaskRow[]);
    for (const op of ops) {
      switch (op.op) {
        case "createSubgoal": {
          const task = await db.task.create({
            data: {
              userId,
              title: op.title,
              description: op.description,
              status: "todo",
              source: op.goal,
              externalTaskId: op.key,
              skipSync: true,
            },
            select: { id: true },
          });
          parentIdByKey.set(op.key, task.id);
          result.changed.push(task.id);
          result.created += 1;
          break;
        }
        case "updateSubgoal":
          await db.task.update({ where: { id: op.id }, data: { title: op.title, description: op.description } });
          result.updated += 1;
          break;
        case "completeSubgoal":
          await db.task.update({ where: { id: op.id }, data: { status: "completed", completedAt: now } });
          result.changed.push(op.id);
          result.completed += 1;
          break;
        case "closeSubgoal":
          await db.task.update({ where: { id: op.id }, data: { closedAt: now } });
          result.closed += 1;
          break;
        case "reopenSubgoal":
          await db.task.update({ where: { id: op.id }, data: { closedAt: null } });
          result.changed.push(op.id);
          result.reopened += 1;
          break;
        case "createItem": {
          const parentTaskId = parentIdByKey.get(op.parentKey);
          if (!parentTaskId) break;
          await db.task.create({
            data: {
              userId,
              title: op.title,
              status: op.done ? "completed" : "todo",
              completedAt: op.done ? now : null,
              source: op.goal,
              externalTaskId: op.key,
              parentTaskId,
              order: op.order,
              skipSync: true,
            },
          });
          result.items.created += 1;
          break;
        }
        case "completeItem":
          await db.task.update({ where: { id: op.id }, data: { status: "completed", completedAt: now } });
          result.items.completed += 1;
          break;
        case "updateItem":
          await db.task.update({ where: { id: op.id }, data: { title: op.title, order: op.order } });
          result.items.updated += 1;
          break;
        case "deleteItem":
          await db.task.delete({ where: { id: op.id } });
          result.items.deleted += 1;
          break;
      }
    }
  }
  return result;
}
