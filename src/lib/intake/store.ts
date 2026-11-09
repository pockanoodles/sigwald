/**
 * Intake against the database: proposals in, decisions out, and the task a
 * proposal becomes. The rules themselves are in ./proposals.ts.
 */
import type { TaskProposal } from "@prisma/client";

import type { Db, DbTransaction } from "@/lib/prisma";

import {
  INTAKE_SOURCE,
  decide,
  taskDescription,
  type KnownWork,
  type ProposalInput,
} from "./proposals";

type Client = Db | DbTransaction;

/** How far back finished work still counts as "already have it". */
const DONE_LOOKBACK_DAYS = 30;

export interface IntakeResult {
  received: number;
  /** Already decided (by the person or on its own), so left as it was. */
  kept: number;
  accepted: number;
  duplicate: number;
  pending: number;
  dismissed: number;
  /** Tasks made, for the goal rules to file. */
  createdTaskIds: string[];
}

/** Everything a new proposal could repeat: open and recently finished tasks, and proposals still waiting. */
async function knownWork(db: Client, userId: string, now: Date, exceptRefs: string[]): Promise<KnownWork[]> {
  const since = new Date(now.getTime() - DONE_LOOKBACK_DAYS * 86_400_000);
  const [tasks, waiting] = await Promise.all([
    db.task.findMany({
      where: {
        userId,
        parentTaskId: null,
        OR: [{ status: { not: "completed" } }, { completedAt: { gte: since } }],
      },
      select: { id: true, title: true, dueDate: true },
    }),
    db.taskProposal.findMany({
      where: { userId, status: "pending", ref: { notIn: exceptRefs } },
      select: { title: true, dueAt: true },
    }),
  ]);
  return [
    ...tasks.map((t) => ({ taskId: t.id, title: t.title, dueAt: t.dueDate })),
    ...waiting.map((p) => ({ taskId: null, title: p.title, dueAt: p.dueAt })),
  ];
}

/** The task a proposal becomes: a plain task, filed under its goal through the claims it carries. */
export async function createTaskFor(
  db: Client,
  userId: string,
  p: Pick<
    TaskProposal,
    "ref" | "title" | "dueAt" | "duration" | "evidence" | "dueText" | "sourceLabel" | "sourceUrl" | "claims"
  >
): Promise<string> {
  const task = await db.task.create({
    data: {
      userId,
      title: p.title,
      description: taskDescription(p),
      status: "todo",
      dueDate: p.dueAt,
      duration: p.duration,
      source: INTAKE_SOURCE,
      externalTaskId: p.ref,
      externalUrl: p.sourceUrl,
      claims: p.claims,
      category: p.claims.includes("CANVAS") ? "SCHOOL" : "PERSONAL",
      // Task sync to Google/Outlook never takes these.
      skipSync: true,
    },
    select: { id: true },
  });
  return task.id;
}

/**
 * Takes a batch of proposals. One already decided is left alone, so a source
 * read again never brings back what the person dismissed; one still waiting is
 * rewritten and decided again (a duplicate may have arrived since).
 */
export async function receiveProposals(
  db: Client,
  userId: string,
  proposals: ProposalInput[],
  now: Date
): Promise<IntakeResult> {
  const result: IntakeResult = {
    received: proposals.length,
    kept: 0,
    accepted: 0,
    duplicate: 0,
    pending: 0,
    dismissed: 0,
    createdTaskIds: [],
  };
  if (proposals.length === 0) return result;

  const refs = proposals.map((p) => p.ref);
  const existing = await db.taskProposal.findMany({
    where: { userId, ref: { in: refs } },
    select: { ref: true, status: true },
  });
  const statusOf = new Map(existing.map((e) => [e.ref, e.status]));
  const known = await knownWork(db, userId, now, refs);

  for (const p of proposals) {
    const before = statusOf.get(p.ref);
    if (before && before !== "pending") {
      result.kept += 1;
      continue;
    }
    const decision = decide(p, known, now);
    const fields = {
      title: p.title,
      dueAt: p.dueAt,
      duration: p.duration,
      evidence: p.evidence,
      dueText: p.dueText,
      sourceLabel: p.sourceLabel,
      sourceUrl: p.sourceUrl,
      claims: p.claims,
      trusted: p.trusted,
      optional: p.optional,
      grounded: p.grounded,
      status: decision.status,
      decidedBy: decision.status === "pending" ? null : "auto",
      decidedAt: decision.status === "pending" ? null : now,
      taskId: decision.status === "duplicate" ? decision.taskId : null,
    };
    const row = await db.taskProposal.upsert({
      where: { userId_ref: { userId, ref: p.ref } },
      create: { ...fields, userId, ref: p.ref },
      update: fields,
      select: { id: true },
    });
    if (decision.status === "accepted") {
      const taskId = await createTaskFor(db, userId, p);
      await db.taskProposal.update({ where: { id: row.id }, data: { taskId } });
      result.createdTaskIds.push(taskId);
      // A later proposal in this batch repeating it is a duplicate of this task.
      known.push({ taskId, title: p.title, dueAt: p.dueAt });
    } else if (decision.status === "pending") {
      known.push({ taskId: null, title: p.title, dueAt: p.dueAt });
    }
    result[decision.status] += 1;
  }
  return result;
}

export type PersonDecision =
  | { action: "accept"; title?: string; dueAt?: Date }
  | { action: "dismiss" };

/**
 * The person's call on a waiting proposal: accept it (as it is, or with the
 * title or deadline fixed) or dismiss it. Null when there's no such waiting
 * proposal of theirs.
 */
export async function decideProposal(
  db: Client,
  userId: string,
  id: string,
  decision: PersonDecision,
  now: Date
): Promise<{ proposal: TaskProposal; taskId: string | null } | null> {
  const proposal = await db.taskProposal.findFirst({ where: { id, userId, status: "pending" } });
  if (!proposal) return null;
  if (decision.action === "dismiss") {
    const updated = await db.taskProposal.update({
      where: { id },
      data: { status: "dismissed", decidedBy: "person", decidedAt: now },
    });
    return { proposal: updated, taskId: null };
  }
  const edited = {
    ...proposal,
    title: decision.title?.trim() || proposal.title,
    dueAt: decision.dueAt ?? proposal.dueAt,
  };
  const taskId = await createTaskFor(db, userId, edited);
  const updated = await db.taskProposal.update({
    where: { id },
    data: {
      title: edited.title,
      dueAt: edited.dueAt,
      status: "accepted",
      decidedBy: "person",
      decidedAt: now,
      taskId,
    },
  });
  return { proposal: updated, taskId };
}
