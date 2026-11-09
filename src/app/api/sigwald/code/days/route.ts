import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { moduleOffResponse } from "@/modules/api";
import { importWorkDays, parseWorkDays } from "@/modules/code/worklog";
import { tasksChanged } from "@/modules/hooks";

const LOG_SOURCE = "CodeDaysAPI";

/**
 * PUT /api/sigwald/code/days
 * Body: { days: [{ repo, label?, day, commits, subjects, lastAt, url? }] }
 *
 * Each repo's day of commits as one finished task (src/modules/code/worklog.ts),
 * then filed under the goals that claim the repo. Safe to send the same days
 * again: a day is written over, never duplicated. Returns
 * { created, updated, unchanged }. 409 while Code is off.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const off = await moduleOffResponse(auth.userId, "code");
    if (off) return off;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return new NextResponse("The body must be JSON", { status: 400 });
    }
    const days = parseWorkDays(raw);
    if (typeof days === "string") return new NextResponse(days, { status: 400 });

    const result = await prisma.$transaction((tx) => importWorkDays(tx, auth.userId, days), {
      timeout: 60_000,
    });
    await tasksChanged(prisma, auth.userId, result.changed);
    return NextResponse.json({
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
    });
  } catch (error) {
    logger.error(
      "Failed to import code days",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to import code days" }, { status: 500 });
  }
}
