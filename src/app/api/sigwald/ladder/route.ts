import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { formatInTimeZone, newDate } from "@/lib/date-utils";
import { itemProof, selfProof, taskProof, type BossProof } from "@/lib/sigwald/boss-proof";
import { ensureCurrentHex, hexOfDay } from "@/lib/sigwald/hex";
import { SOURCE_CLAIMS } from "@/lib/sigwald/goal-input";
import { buildLadder } from "@/lib/sigwald/ladder";
import { openWorkWhere } from "@/lib/sigwald/open-work";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { moduleOffResponse } from "@/modules/api";
import { moduleClaimOptions, moduleProofItems, moduleTaskFacts } from "@/modules/hooks";
import { moduleView } from "@/modules/state";

const LOG_SOURCE = "SigwaldLadderAPI";

/** "All Canvas work" → "Canvas", "All workouts (Training)" → "Workouts (Training)". */
const sourceName = (label: string) => {
  const bare = label.replace(/^All /, "").replace(/ work$/, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
};

/** A date-only value (a boss's day, stored at noon UTC) keeps its own date. */
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * GET /api/sigwald/ladder?year=2026&index=5
 *
 * The Ladder page: one hex (the current one by default) as a character
 * sheet. Stat XP is derived here from finished work on every read
 * (lib/sigwald/xp.ts) and never stored. The current hex is provisioned first,
 * so it always has a row to carry its theme and Build.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;

    const userId = auth.userId;
    const now = newDate();
    const modules = await moduleView(userId);
    const hidden = modules.hidden;
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { timeZone: true },
    });
    const timeZone = settings?.timeZone ?? "UTC";
    const dayOf = (d: Date) => formatInTimeZone(d, timeZone, "yyyy-MM-dd");
    const today = dayOf(now);

    const params = request.nextUrl.searchParams;
    const year = Number(params.get("year"));
    const index = Number(params.get("index"));
    const hex =
      Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isInteger(index) && index >= 1 && index <= 6
        ? { year, index }
        : hexOfDay(today);

    const running = await ensureCurrentHex(prisma, userId);

    const [goals, done, open, cycles] = await Promise.all([
      prisma.goal.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          isBoss: true,
          status: true,
          develops: true,
          targetDate: true,
          updatedAt: true,
          externalId: true,
          importanceScore: true,
          taskSources: true,
          cycleId: true,
          whyItMatters: true,
          definitionOfDone: true,
          canvasAssignmentId: true,
          proofTaskId: true,
          parentLinks: { select: { parentId: true } },
        },
      }),
      // Subtasks are checklist items under a task, not work of their own.
      prisma.task.findMany({
        where: { userId, parentTaskId: null, status: "completed", completedAt: { not: null } },
        select: {
          id: true,
          title: true,
          completedAt: true,
          goalLinks: { select: { goalId: true } },
        },
      }),
      // Open the way the top bar counts it: work you can act on now.
      prisma.task.findMany({
        where: openWorkWhere(userId, now, hidden),
        select: { id: true, goalLinks: { select: { goalId: true } } },
      }),
      prisma.goalCycle.findMany({
        where: { userId },
        select: { id: true, theme: true, focusStats: true, buildProjected: true, startDate: true },
      }),
    ]);

    // The XP log names a finished task's course by its label: Courses' fact.
    const facts = await moduleTaskFacts(
      prisma,
      userId,
      done.map((task) => ({ id: task.id })),
      modules.isOn
    );
    const courseOf = (id: string) => {
      const label = facts.get(id)?.courseLabel;
      return typeof label === "string" ? label : null;
    };

    // What each boss's proof says now: its Canvas gradebook item, or its task.
    const bosses = goals.filter((goal) => goal.isBoss);
    const canvasIds = bosses.flatMap((goal) => (goal.canvasAssignmentId ? [goal.canvasAssignmentId] : []));
    const proofTaskIds = bosses.flatMap((goal) =>
      !goal.canvasAssignmentId && goal.proofTaskId ? [goal.proofTaskId] : []
    );
    const [items, proofTasks, offered] = await Promise.all([
      moduleProofItems(prisma, userId, canvasIds),
      proofTaskIds.length
        ? prisma.task.findMany({ where: { id: { in: proofTaskIds }, userId }, select: { id: true, status: true } })
        : [],
      // What each goal's claims are called, for its "Fed by".
      moduleClaimOptions(prisma, userId),
    ]);
    // A whole source reads as its name ("Canvas"); the form's "All Canvas work" is a chip, not a column.
    const claimLabels = Object.fromEntries([
      ...SOURCE_CLAIMS.map((o) => [o.key, sourceName(o.label)] as const),
      ...offered.map((o) => [o.key, o.label] as const),
    ]);
    const itemOf = new Map(items.map((item) => [item.ref, item]));
    const taskOf = new Map(proofTasks.map((task) => [task.id, task]));
    const proofOf = (goal: (typeof goals)[number]): BossProof | null => {
      if (!goal.isBoss) return null;
      if (goal.canvasAssignmentId) return itemProof(itemOf.get(goal.canvasAssignmentId));
      const task = goal.proofTaskId ? taskOf.get(goal.proofTaskId) : undefined;
      return task ? taskProof(task) : selfProof(goal.status);
    };

    return NextResponse.json(
      buildLadder({
        today,
        hex,
        currentCycleId: running.id,
        goals: goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          isBoss: goal.isBoss,
          status: goal.status,
          develops: goal.develops,
          parentIds: goal.parentLinks.map((link) => link.parentId),
          day: goal.targetDate ? dateOnly(goal.targetDate) : null,
          updatedDay: dayOf(goal.updatedAt),
          targetDate: goal.targetDate?.toISOString() ?? null,
          externalId: goal.externalId,
          importanceScore: goal.importanceScore,
          taskSources: goal.taskSources,
          cycleId: goal.cycleId,
          whyItMatters: goal.whyItMatters,
          definitionOfDone: goal.definitionOfDone,
          proof: proofOf(goal),
        })),
        done: done.map((task) => ({
          id: task.id,
          title: task.title,
          day: dayOf(task.completedAt!),
          course: courseOf(task.id),
          goalIds: task.goalLinks.map((link) => link.goalId),
        })),
        open: open.map((task) => ({
          id: task.id,
          goalIds: task.goalLinks.map((link) => link.goalId),
        })),
        claimLabels,
        cycles: cycles.map((cycle) => ({
          id: cycle.id,
          theme: cycle.theme,
          focusStats: cycle.focusStats,
          buildProjected: cycle.buildProjected,
          first: dateOnly(cycle.startDate),
        })),
      })
    );
  } catch (error) {
    logger.error(
      "Sigwald ladder failed",
      { error: error instanceof Error ? error.message : "Unknown error" },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to load the Ladder" }, { status: 500 });
  }
}
