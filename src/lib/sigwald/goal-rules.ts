import type { Db, DbTransaction } from "@/lib/prisma";

import { moduleClaimKeys, moduleProofItems } from "@/modules/hooks";

/**
 * Files tasks under the goals they serve, and settles bosses from their proof.
 * The rules are declared on the goals, by the vault through pump 7 or by hand
 * in Sigwald; Sigwald only applies them.
 *
 *  - A goal in play claims every task matching one of its claims: a task
 *    source (CANVAS), `project:<id>`, a key a module adds to its tasks
 *    (Courses: `course:<Canvas course id>`), or one its creator declared in
 *    Task.claims (intake: a task read out of a Canvas announcement carries
 *    CANVAS, so School claims it). A vault goal also claims its own
 *    "venture:<slug>", the tasks pump 2 decomposed from it.
 *  - A boss with proof is settled by it (lib/sigwald/boss-proof.ts). A Canvas
 *    gradebook item or a task fells the boss once the work is handed in, and
 *    the item's due date becomes the boss's date. The proof's task is filed
 *    under the boss, so its work counts toward the goal above.
 *  - A goal that is done or set aside claims nothing new, but a finished
 *    task keeps its link to it: that link is the goal's history and its XP.
 *
 * Runs after every projection, every Canvas sync and every task or goal
 * edit, so a new assignment is filed the moment it lands. A task whose goals
 * were picked by hand is pinned and never touched. Every other link belongs to
 * these rules, so one no rule produces anymore is removed.
 */

export interface BossBinding {
  goalId: string;
  externalId: string | null;
  canvasAssignmentId: string;
  /** Null when the gradebook has no item with that id: the boss names one Sigwald lacks. */
  item: { dueDate: Date | null } | null;
}

export interface GoalRulesResult {
  linked: number;
  unlinked: number;
  bindings: BossBinding[];
}

/**
 * A timestamp's calendar day on this machine, which runs in Kaito's zone. A
 * Canvas "11:59 PM" due time is 04:59 UTC the next day, so slicing the ISO
 * string would put the boss a day late.
 */
export const calendarDay = (d: Date) => d.toLocaleDateString("en-CA");

/** Goal target dates are date-only, stored at noon UTC like pump 7 sends them
 *  so they read as the same day in any US zone. */
const bossDate = (due: Date) => new Date(`${calendarDay(due)}T12:00:00.000Z`);

const sameDay = (a: Date | null, b: Date) => a !== null && a.getTime() === b.getTime();

interface RuleGoal {
  id: string;
  externalId: string | null;
  isBoss: boolean;
  status: string;
  taskSources: string[];
}

interface RuleTask {
  id: string;
  source: string | null;
  /** Keys the modules add (`moduleClaimKeys`): Courses' `course:<Canvas course id>`. */
  claims: string[];
  projectId: string | null;
  status: string;
  goalLinks: { id: string; goalId: string }[];
}

/** What a goal can claim a task by. */
export function claimKeys(task: Pick<RuleTask, "source" | "claims" | "projectId">): string[] {
  return [
    ...(task.source ? [task.source] : []),
    ...task.claims,
    ...(task.projectId ? [`project:${task.projectId}`] : []),
  ];
}

/**
 * The link changes that bring unpinned tasks in line with the rules: links
 * to add, and ids of links no rule produces. Pure, so the rules are testable.
 */
export function planLinks(
  goals: RuleGoal[],
  bossesByTask: Map<string, string[]>,
  tasks: RuleTask[]
): { create: { taskId: string; goalId: string }[]; stale: string[] } {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const claimants = new Map<string, string[]>();
  const claim = (key: string, goalId: string) => claimants.set(key, [...(claimants.get(key) ?? []), goalId]);
  for (const g of goals) {
    if (g.isBoss || g.status !== "active") continue;
    if (g.externalId) claim(g.externalId, g.id);
    for (const key of g.taskSources) claim(key, g.id);
  }

  const create: { taskId: string; goalId: string }[] = [];
  const stale: string[] = [];
  for (const task of tasks) {
    const desired = new Set([
      ...claimKeys(task).flatMap((key) => claimants.get(key) ?? []),
      ...(bossesByTask.get(task.id) ?? []),
    ]);
    const have = new Set(task.goalLinks.map((l) => l.goalId));
    for (const goalId of desired) {
      if (!have.has(goalId)) create.push({ taskId: task.id, goalId });
    }
    for (const link of task.goalLinks) {
      if (desired.has(link.goalId)) continue;
      // Finished work stays with a goal that is done or set aside: its history.
      const goal = byId.get(link.goalId);
      if (task.status === "completed" && goal && goal.status !== "active") continue;
      stale.push(link.id);
    }
  }
  return { create, stale };
}

export async function applyGoalRules(
  db: Db | DbTransaction,
  userId: string,
  scope: { taskIds?: string[] } = {}
): Promise<GoalRulesResult> {
  const goals = await db.goal.findMany({
    where: { userId },
    select: {
      id: true,
      externalId: true,
      isBoss: true,
      status: true,
      taskSources: true,
      targetDate: true,
      canvasAssignmentId: true,
      proofTaskId: true,
    },
  });

  // Settle each boss from its proof. A boss set aside is left as it was.
  const proven = goals.filter((g) => g.isBoss && g.status !== "dropped" && (g.canvasAssignmentId || g.proofTaskId));
  const canvasIds = proven.flatMap((g) => (g.canvasAssignmentId ? [g.canvasAssignmentId] : []));
  const taskIds = proven.flatMap((g) => (!g.canvasAssignmentId && g.proofTaskId ? [g.proofTaskId] : []));
  const [items, proofTasks] = await Promise.all([
    moduleProofItems(db, userId, canvasIds),
    taskIds.length
      ? db.task.findMany({
          where: { id: { in: taskIds }, userId },
          select: { id: true, status: true, dueDate: true, goalsPinned: true },
        })
      : [],
  ]);
  const itemByCanvasId = new Map(items.map((i) => [i.ref, i]));
  const taskById = new Map(proofTasks.map((t) => [t.id, t]));

  const bindings: BossBinding[] = [];
  const bossesByTask = new Map<string, string[]>();
  for (const boss of proven) {
    let due: Date | null = null;
    let handedIn = false;
    let task: { id: string; goalsPinned: boolean } | null = null;
    if (boss.canvasAssignmentId) {
      const item = itemByCanvasId.get(boss.canvasAssignmentId) ?? null;
      bindings.push({
        goalId: boss.id,
        externalId: boss.externalId,
        canvasAssignmentId: boss.canvasAssignmentId,
        item: item && { dueDate: item.dueAt },
      });
      if (!item) continue;
      due = item.dueAt;
      handedIn = item.settles;
      task = item.task;
    } else {
      const proof = taskById.get(boss.proofTaskId!);
      if (!proof) continue;
      due = proof.dueDate;
      handedIn = proof.status === "completed";
      task = proof;
    }

    const date = due ? bossDate(due) : null;
    const moveDate = date !== null && !sameDay(boss.targetDate, date);
    const fell = handedIn && boss.status === "active";
    if (moveDate || fell) {
      await db.goal.update({
        where: { id: boss.id },
        data: { ...(moveDate && { targetDate: date }), ...(fell && { status: "done" }) },
      });
    }
    if (task && !task.goalsPinned) {
      bossesByTask.set(task.id, [...(bossesByTask.get(task.id) ?? []), boss.id]);
    }
  }

  const tasks = await db.task.findMany({
    where: {
      userId,
      goalsPinned: false,
      ...(scope.taskIds && { id: { in: scope.taskIds } }),
    },
    select: {
      id: true,
      source: true,
      projectId: true,
      status: true,
      claims: true,
      goalLinks: { select: { id: true, goalId: true } },
    },
  });
  const claims = await moduleClaimKeys(
    db,
    userId,
    tasks.map((t) => t.id)
  );

  const { create, stale } = planLinks(
    goals,
    bossesByTask,
    // A task's claims: what its creator declared (intake's CANVAS, course:<id>) and what its modules add.
    tasks.map((t) => ({ ...t, claims: [...t.claims, ...(claims.get(t.id) ?? [])] }))
  );

  if (create.length) {
    await db.taskGoalLink.createMany({ data: create, skipDuplicates: true });
  }
  if (stale.length) {
    await db.taskGoalLink.deleteMany({ where: { id: { in: stale } } });
  }

  return { linked: create.length, unlinked: stale.length, bindings };
}
