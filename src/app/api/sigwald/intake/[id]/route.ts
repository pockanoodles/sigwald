import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { decideProposal, type PersonDecision } from "@/lib/intake/store";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { tasksChanged } from "@/modules/hooks";

const LOG_SOURCE = "IntakeDecisionAPI";

/**
 * POST /api/sigwald/intake/:id
 * Body: { action: "accept", title?, dueAt? } | { action: "dismiss" }
 *
 * The person's call on a waiting proposal. Accepting makes its task (filed
 * under its goal by the claims it carries). 404 when it isn't waiting.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    let decision: PersonDecision;
    if (body?.action === "dismiss") {
      decision = { action: "dismiss" };
    } else if (body?.action === "accept") {
      const dueAt = typeof body.dueAt === "string" ? new Date(body.dueAt) : undefined;
      if (dueAt && Number.isNaN(dueAt.getTime())) return new NextResponse("dueAt must be an ISO time", { status: 400 });
      const title = typeof body.title === "string" ? body.title.slice(0, 140) : undefined;
      decision = { action: "accept", title, dueAt };
    } else {
      return new NextResponse('action must be "accept" or "dismiss"', { status: 400 });
    }
    const result = await prisma.$transaction((tx) => decideProposal(tx, auth.userId, id, decision, newDate()));
    if (!result) return new NextResponse("No waiting proposal with that id", { status: 404 });
    if (result.taskId) await tasksChanged(prisma, auth.userId, [result.taskId]);
    return NextResponse.json(result);
  } catch (error) {
    logger.error(
      "Failed to decide a proposal",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to decide the proposal" }, { status: 500 });
  }
}
