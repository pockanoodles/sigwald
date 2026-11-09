import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { applyGoalPlans, parsePlans } from "@/lib/sigwald/goal-plans";

import { moduleOffResponse } from "@/modules/api";
import { tasksChanged } from "@/modules/hooks";

const LOG_SOURCE = "GoalPlansAPI";

/**
 * PUT /api/sigwald/goals/plans
 * Body: { goals: [{ goal: "venture:<slug>", path?, subgoals: [{ key, title,
 *   metric?, state: open|achieved|parked|superseded, items: [{ key, title, done }] }] }] }
 *
 * Each subgoal as a task under its goal, its checklist as subtasks
 * (src/lib/sigwald/goal-plans.ts). Every goal listed is reconciled whole: a
 * subgoal it no longer lists is closed. Goals not listed are left alone.
 * Returns what changed, and any goal ids the user has no goal for.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return new NextResponse("The body must be JSON", { status: 400 });
    }
    const plans = parsePlans(raw);
    if (typeof plans === "string") return new NextResponse(plans, { status: 400 });
    const result = await prisma.$transaction((tx) => applyGoalPlans(tx, auth.userId, plans, newDate()), {
      timeout: 60_000,
    });
    await tasksChanged(prisma, auth.userId, result.changed);
    const { changed, ...counts } = result;
    return NextResponse.json({ ...counts, changed: changed.length });
  } catch (error) {
    logger.error(
      "Failed to apply goal plans",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to apply goal plans" }, { status: 500 });
  }
}
