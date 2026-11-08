/**
 * Sigwald Stage 1 ranking (deterministic): filters, urgency tiers, base score, filler lane.
 * Spec: technical spec §5.2 (May 1, 2026).
 *
 * It knows no module. What a task is worth arrives as `impact` (set by the
 * module that owns it: Courses scores coursework by its share of the grade),
 * `lift` (another module vouching for it: Ladder, by its goals) and
 * `stakes` (how big it is among its peers: Courses, its share of the grade
 * within a course).
 */
import type { Task } from "@prisma/client";

const W_IMPACT = 0.35;
const W_DEADLINE = 0.45;
const W_EFFORT = 0.2;
const K_SIGMOID = 0.15;
const HOURS_MIDPOINT = 48;
const VISIBILITY_BOOST = 0.15;
const LATE_PENALTY_PER_DAY = 0.1;

/**
 * Skip and Later (spec §5.3.6 named the skip signal but only Stage 2 ever
 * scored it, so Skip once incremented `skipCount`/`lastSkippedAt` and changed
 * nothing — the refetched queue re-served the same card). Two mechanisms,
 * deliberately separate:
 *
 * 1. A rest. A skipped task rests for four hours; a task put off with Later
 *    rests until its `postponedUntil`. Resting sorts it below every task
 *    that isn't, ahead of the score entirely, so Focus moves on. It has to
 *    outrank DANGER: the task you skipped is usually top *because* it is
 *    urgent, and a score-only penalty would leave it at #1 — which is the bug.
 *    Resting is a sort key, never a filter, so if everything rests the
 *    normal order still applies and Focus never runs dry. And a rest never
 *    runs past the deadline: it ends `restLeadMinutes` before the task is
 *    due, and inside that window there's nothing left to put off (see
 *    `restOf`). Today ignores rests altogether: it lists everything in its
 *    place and marks what rests (`orderTasksStage1`'s `restingLast`).
 * 2. A decaying score penalty that outlives the rest, so a task you keep
 *    skipping drifts down instead of bouncing back to #1 every four hours.
 *    It halves every two days, so genuine avoidance costs a task its lead
 *    while a single skip on a busy afternoon is forgotten by the weekend.
 *
 * Escalation still wins in the end: `isSkipSpiralDanger` promotes a
 * high-impact task with a near deadline once it has been skipped three times,
 * and that fires as soon as the rest ends.
 */
const SKIP_COOLDOWN_HOURS = 4;
/** Time kept free before a deadline on top of the task's own effort. */
const REST_SLACK_MINUTES = 60;
const SKIP_PENALTY_PER_SKIP = 0.05;
const SKIP_PENALTY_MAX = 0.2;
const SKIP_PENALTY_HALF_LIFE_HOURS = 48;

export type UrgencyTier = "DANGER" | "HIGH" | "NORMAL" | "LOW" | "NONE";

export type TaskForRanking = Pick<
  Task,
  | "id"
  | "title"
  | "status"
  | "dueDate"
  | "unlockAt"
  | "lockAt"
  | "duration"
  | "impact"
  | "closedAt"
  | "priority"
  | "skipCount"
  | "lastSkippedAt"
  | "createdAt"
  | "postponedUntil"
> & {
  /**
   * How much another module lifts this task, 0–1 (Ladder: the importance of
   * its most important active goal). `focus-queue-core` asks the module
   * registry; it feeds the impact term beside the task's own `impact`.
   * `null` when nothing lifts it.
   */
  lift?: number | null;
  /**
   * How much rides on it in its group's own units, and the group it's
   * compared within (Courses: share of the grade, within one course). Only the
   * long-horizon boost reads them.
   */
  stakes?: number | null;
  stakesGroup?: string | null;
  /** Subtasks never surface in Focus; the parent is the work item. */
  parentTaskId?: string | null;
};

const COMPLETED_STATUSES = new Set(["completed"]);

function hoursUntilDueDate(task: TaskForRanking, now: Date): number | null {
  if (!task.dueDate) {
    return null;
  }
  return (new Date(task.dueDate).getTime() - now.getTime()) / 3_600_000;
}

/**
 * DANGER tier (spec §5.2.2): too little time left vs estimated effort, or overdue.
 */
export function isDangerForFocus(task: TaskForRanking, now: Date): boolean {
  if (COMPLETED_STATUSES.has(task.status)) {
    return false;
  }
  const estMinutes = task.duration ?? 30;
  const due = task.dueDate ? new Date(task.dueDate) : null;
  if (!due) {
    return false;
  }
  const minutesUntil = (due.getTime() - now.getTime()) / 60_000;
  if (minutesUntil < 0) {
    if (task.lockAt && now <= new Date(task.lockAt)) {
      return true;
    }
    return true;
  }
  return minutesUntil < estMinutes * 3;
}

/**
 * Skip spiral escalation to DANGER (spec §5.3.6): high-impact task skipped often with deadline near.
 */
export function isSkipSpiralDanger(task: TaskForRanking, now: Date): boolean {
  if ((task.skipCount ?? 0) < 3) {
    return false;
  }
  if ((task.impact ?? 0) <= 0.5) {
    return false;
  }
  const h = hoursUntilDueDate(task, now);
  if (h == null || h < 0) {
    return false;
  }
  return h <= 24 * 5;
}

export function isDangerResolved(task: TaskForRanking, now: Date): boolean {
  return isDangerForFocus(task, now) || isSkipSpiralDanger(task, now);
}

function hoursSinceSkip(task: TaskForRanking, now: Date): number | null {
  if (!task.lastSkippedAt) {
    return null;
  }
  const h =
    (now.getTime() - new Date(task.lastSkippedAt).getTime()) / 3_600_000;
  // A clock skew or a client-set future timestamp shouldn't read as "skipped
  // ages ago" and quietly cancel the cooldown; treat it as skipped just now.
  return Math.max(0, h);
}

/** Why a task rests and until when; see the note above SKIP_COOLDOWN_HOURS. */
export interface Rest {
  reason: "skipped" | "later";
  until: Date;
}

/**
 * How long before its deadline a task stops resting: its effort plus an hour,
 * so it's back in Focus with time to do it.
 */
export function restLeadMinutes(
  task: Pick<TaskForRanking, "duration">
): number {
  return (task.duration ?? 30) + REST_SLACK_MINUTES;
}

/**
 * Whether a task rests, and until when: whichever of its skip and its Later
 * ends last, cut short `restLeadMinutes` before a deadline still ahead. Null
 * when it doesn't rest, including a task already inside that window: one due
 * that soon can't be put off, only done. Work already overdue rests as asked,
 * since there's no deadline left to protect.
 */
export function restOf(task: TaskForRanking, now: Date): Rest | null {
  const rests: Rest[] = [];
  const h = hoursSinceSkip(task, now);
  if (h != null && h < SKIP_COOLDOWN_HOURS) {
    rests.push({
      reason: "skipped",
      until: new Date(now.getTime() + (SKIP_COOLDOWN_HOURS - h) * 3_600_000),
    });
  }
  if (task.postponedUntil && new Date(task.postponedUntil) > now) {
    rests.push({ reason: "later", until: new Date(task.postponedUntil) });
  }
  if (rests.length === 0) {
    return null;
  }
  let rest = rests.reduce((a, b) => (b.until > a.until ? b : a));
  const due = task.dueDate ? new Date(task.dueDate) : null;
  if (due && due > now) {
    const latest = new Date(due.getTime() - restLeadMinutes(task) * 60_000);
    if (latest < rest.until) {
      rest = { ...rest, until: latest };
    }
  }
  return rest.until > now ? rest : null;
}

/**
 * Whether a Later or a Defer hides a task from every list right now. It
 * doesn't when the task is due before the deferral ends: then it stays on
 * Today, marked, and only rests in Focus (`restOf`) — putting work off must
 * never hide it past its deadline.
 */
export function deferralHides(
  task: Pick<TaskForRanking, "postponedUntil" | "dueDate">,
  now: Date
): boolean {
  if (!task.postponedUntil) {
    return false;
  }
  const until = new Date(task.postponedUntil);
  if (until <= now) {
    return false;
  }
  return !(task.dueDate && new Date(task.dueDate) <= until);
}

/**
 * Score penalty for repeated skips, decaying by half every
 * SKIP_PENALTY_HALF_LIFE_HOURS since the most recent one. Zero for a task that
 * has never been skipped, so untouched rankings are bit-identical to before.
 */
export function skipPenalty(task: TaskForRanking, now: Date): number {
  const count = task.skipCount ?? 0;
  const h = hoursSinceSkip(task, now);
  if (count <= 0 || h == null) {
    return 0;
  }
  const magnitude = Math.min(SKIP_PENALTY_MAX, SKIP_PENALTY_PER_SKIP * count);
  return magnitude * Math.pow(0.5, h / SKIP_PENALTY_HALF_LIFE_HOURS);
}

/**
 * Spec §5.2.4 — sigmoid deadline pressure; late-but-before-lock stays at max; no due date → 0.
 */
export function deadlinePressure(task: TaskForRanking, now: Date): number {
  if (!task.dueDate) {
    return 0;
  }
  const due = new Date(task.dueDate);
  const lock = task.lockAt ? new Date(task.lockAt) : null;
  const hoursUntil = (due.getTime() - now.getTime()) / 3_600_000;

  if (hoursUntil < 0) {
    if (lock && now.getTime() <= lock.getTime()) {
      return 1;
    }
    return 1;
  }

  return 1 / (1 + Math.exp(K_SIGMOID * (hoursUntil - HOURS_MIDPOINT)));
}

/**
 * Late penalty on a task's own impact after due_at (spec §5.2.4).
 */
export function effectiveImpact(task: TaskForRanking, now: Date): number {
  const g = task.impact ?? 0;
  if (!task.dueDate) {
    return g;
  }
  const due = new Date(task.dueDate);
  if (now.getTime() <= due.getTime()) {
    return g;
  }
  const lock = task.lockAt ? new Date(task.lockAt) : null;
  if (lock && now.getTime() > lock.getTime()) {
    return Math.max(0.05, g * 0.5);
  }
  const daysLate = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  const penalty = Math.min(0.9, LATE_PENALTY_PER_DAY * Math.max(0, daysLate));
  return Math.max(0.05, g * (1 - penalty));
}

/**
 * Another module's lift as a 0–1 impact signal parallel to the task's own.
 * Tasks nothing lifts contribute 0, so impact-only ranking is unchanged.
 */
export function effectiveLift(task: TaskForRanking): number {
  const l = task.lift;
  if (l == null) {
    return 0;
  }
  return Math.min(1, Math.max(0, l));
}

/**
 * Raw (pre-pool-normalization) impact for a task: the stronger of its own
 * impact and its lift. A task surfaces on its best reason to matter (a big
 * grade OR an important personal goal); taking the max avoids
 * double-counting a task that is both.
 */
function rawImpact(task: TaskForRanking, now: Date): number {
  return Math.max(effectiveImpact(task, now), effectiveLift(task));
}

/**
 * Spec §5.2.5 — effort fit vs available slot (0–1).
 */
export function effortFit(
  estimatedMinutes: number,
  slotMinutes: number
): number {
  const est = Math.max(1, estimatedMinutes);
  const slot = Math.max(1, slotMinutes);
  return 1 - Math.abs(est - slot) / Math.max(est, slot);
}

function percentile80(values: number[]): number {
  if (values.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.8 * s.length) - 1;
  return s[Math.max(0, idx)] ?? Number.POSITIVE_INFINITY;
}

/**
 * Long-horizon visibility boost (spec §5.2.7): work due more than a week out
 * whose stakes top the 80th percentile of its group's surfaces early, so a
 * big project isn't first seen the week it's due.
 */
export function visibilityBoost(
  task: TaskForRanking,
  candidates: TaskForRanking[],
  now: Date
): number {
  const h = hoursUntilDueDate(task, now);
  if (h == null || h <= 24 * 7) {
    return 0;
  }
  const stakes = task.stakes ?? 0;
  if (stakes <= 0 || !task.stakesGroup) {
    return 0;
  }
  const p80 = percentile80(
    candidates
      .filter((t) => t.stakesGroup === task.stakesGroup)
      .map((t) => t.stakes ?? 0)
  );
  if (!Number.isFinite(p80) || stakes <= p80) {
    return 0;
  }
  return VISIBILITY_BOOST;
}

/** What modules tell the ranking about a task (`moduleRankSignals`). */
export type RankSignals = Pick<
  TaskForRanking,
  "lift" | "stakes" | "stakesGroup"
>;

/**
 * Assign urgency tier (spec §5.2.2). DANGER uses resolved danger (including skip spiral).
 */
export function computeUrgencyTier(
  task: TaskForRanking,
  now: Date,
  danger: boolean
): UrgencyTier {
  if (danger) {
    return "DANGER";
  }
  const h = hoursUntilDueDate(task, now);
  if (h == null) {
    return "NONE";
  }
  if (h < 0) {
    return "DANGER";
  }
  if (h <= 24) {
    return "HIGH";
  }
  if (h <= 24 * 7) {
    return "NORMAL";
  }
  return "LOW";
}

/**
 * Normalizes the combined impact signal (own impact ∪ lift) across the
 * candidate pool so grade-driven and goal-driven tasks compete on one 0–1 scale.
 */
function normalizeImpactPool(
  tasks: TaskForRanking[],
  now: Date
): Map<string, number> {
  const raw = tasks.map((t) => rawImpact(t, now));
  const maxImpact = Math.max(...raw, 1e-9);
  const map = new Map<string, number>();
  for (const t of tasks) {
    map.set(t.id, rawImpact(t, now) / maxImpact);
  }
  return map;
}

function nominalSlotMinutes(slotMinutes: number | null): number {
  if (slotMinutes == null || !Number.isFinite(slotMinutes)) {
    return 240;
  }
  if (slotMinutes === Number.POSITIVE_INFINITY || slotMinutes <= 0) {
    return 240;
  }
  return slotMinutes;
}

/**
 * Filler: work nothing rides on — no impact from its module, no lift from
 * another, not marked high priority. It waits while any work that does carry
 * impact is DANGER or HIGH (the filler lane).
 */
export function isFillerCandidate(task: TaskForRanking): boolean {
  if (task.priority === "high") {
    return false;
  }
  // Lifted tasks (a goal vouches for them) compete in the main pool and are
  // never demoted to the filler lane.
  if (task.lift != null) {
    return false;
  }
  return task.impact == null;
}

/** Whether any work that carries impact is DANGER or HIGH, which puts filler on hold. */
export function impactWorkIsUrgent(
  candidates: TaskForRanking[],
  now: Date
): boolean {
  return candidates.some((t) => {
    if (t.impact == null) {
      return false;
    }
    const danger = isDangerResolved(t, now);
    const tier = computeUrgencyTier(t, now, danger);
    return tier === "DANGER" || tier === "HIGH";
  });
}

export interface Stage1Scores {
  baseScore: number;
  urgencyTier: UrgencyTier;
  danger: boolean;
  fillerDemoted: boolean;
  /** Skipped or put off (`restOf`): Focus sorts it below everything else. */
  resting: boolean;
}

export function computeStage1Scores(
  task: TaskForRanking,
  candidates: TaskForRanking[],
  now: Date,
  slotMinutes: number | null,
  normImpact: Map<string, number>
): Stage1Scores {
  const danger = isDangerResolved(task, now);
  const urgencyTier = computeUrgencyTier(task, now, danger);
  const demote = impactWorkIsUrgent(candidates, now) && isFillerCandidate(task);

  // Impact term (weight 0.35) is the pool-normalized max of the task's own
  // impact and its lift — a personal goal is a first-class reason to work on a
  // task, so it competes in the main pool alongside grade-driven coursework
  // rather than in the filler lane. Deadline (0.45) and effort (0.2) weights
  // are unchanged.
  const ni = normImpact.get(task.id) ?? 0;
  const dp = deadlinePressure(task, now);
  const slot = nominalSlotMinutes(slotMinutes);
  const ef = effortFit(task.duration ?? 30, slot);
  let base = W_IMPACT * ni + W_DEADLINE * dp + W_EFFORT * ef;
  base += visibilityBoost(task, candidates, now);
  base -= skipPenalty(task, now);
  base = Math.min(2, Math.max(0, base));

  return {
    baseScore: base,
    urgencyTier,
    danger,
    fillerDemoted: demote,
    resting: restOf(task, now) != null,
  };
}

/**
 * Filters tasks that should never surface in Focus (completed, locked,
 * still-deferred, etc.).
 */
export function filterTasksForRanking(
  tasks: TaskForRanking[],
  now: Date
): TaskForRanking[] {
  return tasks.filter((t) => {
    if (t.parentTaskId) {
      return false;
    }
    if (COMPLETED_STATUSES.has(t.status)) {
      return false;
    }
    // Closed by its source without being done (Canvas: missed, or the course
    // ended). Work Canvas took in is completed, caught above.
    if (t.closedAt) {
      return false;
    }
    if (t.unlockAt && new Date(t.unlockAt) > now) {
      return false;
    }
    if (deferralHides(t, now)) {
      return false;
    }
    return true;
  });
}

export interface OrderStage1Options {
  slotMinutes: number | null;
  /**
   * Sort resting tasks last: what to do next (Focus, and ops' "top task").
   * False keeps every task in its place on its merits: the full list (Today),
   * which marks what rests instead of moving it. Defaults to true.
   */
  restingLast?: boolean;
}

/**
 * Ordering: resting (unless `restingLast` is false), then filler demotion
 * when work with impact is urgent, then DANGER, then base score, then due,
 * title.
 */
export function orderTasksStage1(
  tasks: TaskForRanking[],
  now: Date,
  options: OrderStage1Options
): TaskForRanking[] {
  const { slotMinutes, restingLast = true } = options;
  if (tasks.length === 0) {
    return [];
  }
  const normImpact = normalizeImpactPool(tasks, now);

  const scored = tasks.map((t) => ({
    task: t,
    ...computeStage1Scores(t, tasks, now, slotMinutes, normImpact),
  }));

  scored.sort((a, b) => {
    // Outermost key, above DANGER: skipping a task has to move you on even
    // when that task is the urgent one. If every candidate rests this
    // compares equal and the rest of the ordering takes over unchanged.
    if (restingLast) {
      const ra = a.resting ? 1 : 0;
      const rb = b.resting ? 1 : 0;
      if (ra !== rb) {
        return ra - rb;
      }
    }
    const da = a.fillerDemoted ? 1 : 0;
    const db = b.fillerDemoted ? 1 : 0;
    if (da !== db) {
      return da - db;
    }
    const dangerA = a.danger ? 1 : 0;
    const dangerB = b.danger ? 1 : 0;
    if (dangerB !== dangerA) {
      return dangerB - dangerA;
    }
    if (b.baseScore !== a.baseScore) {
      return b.baseScore - a.baseScore;
    }
    const dta = a.task.dueDate
      ? new Date(a.task.dueDate).getTime()
      : Number.POSITIVE_INFINITY;
    const dtb = b.task.dueDate
      ? new Date(b.task.dueDate).getTime()
      : Number.POSITIVE_INFINITY;
    if (dta !== dtb) {
      return dta - dtb;
    }
    return a.task.title.localeCompare(b.task.title);
  });

  return scored.map((s) => s.task);
}

/**
 * Returns the single top task for Focus Mode (Stage 1 only).
 */
export function pickTopTaskStage1(
  tasks: TaskForRanking[],
  now: Date,
  options: OrderStage1Options
): TaskForRanking | null {
  const filtered = filterTasksForRanking(tasks, now);
  const candidates = orderTasksStage1(filtered, now, options);
  return candidates[0] ?? null;
}

/**
 * Stage 1 scores for each ordered task (same candidate pool as ranking).
 */
export function stage1MetaForTasks(
  ordered: TaskForRanking[],
  pool: TaskForRanking[],
  now: Date,
  slotMinutes: number | null
): Map<string, Stage1Scores> {
  const normImpact = normalizeImpactPool(pool, now);
  const out = new Map<string, Stage1Scores>();
  for (const t of ordered) {
    out.set(t.id, computeStage1Scores(t, pool, now, slotMinutes, normImpact));
  }
  return out;
}
