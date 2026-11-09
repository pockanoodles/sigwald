import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { parseProposals } from "@/lib/intake/proposals";
import { receiveProposals } from "@/lib/intake/store";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { tasksChanged } from "@/modules/hooks";

const LOG_SOURCE = "IntakeAPI";
const STATUSES = new Set(["pending", "accepted", "dismissed", "duplicate"]);

/**
 * GET /api/sigwald/intake[?status=pending|accepted|dismissed|duplicate]
 * Proposals in that state (pending by default), soonest due first.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const status = request.nextUrl.searchParams.get("status") ?? "pending";
    if (!STATUSES.has(status)) return new NextResponse(`unknown status ${status}`, { status: 400 });
    const proposals = await prisma.taskProposal.findMany({
      where: { userId: auth.userId, status },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 200,
    });
    return NextResponse.json({ proposals });
  } catch (error) {
    logger.error(
      "Failed to list proposals",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to list proposals" }, { status: 500 });
  }
}

/**
 * PUT /api/sigwald/intake
 * Body: { proposals: [{ ref, title, dueAt, duration?, evidence, dueText,
 *   sourceLabel, sourceUrl?, claims?, trusted, optional, grounded }] }
 *
 * Work a script read out of a source, proposed as tasks
 * (src/lib/intake/proposals.ts decides). Safe to send again: a proposal is
 * keyed by its ref, and one already decided stays decided. Returns how each
 * landed.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return new NextResponse("The body must be JSON", { status: 400 });
    }
    const proposals = parseProposals(raw);
    if (typeof proposals === "string") return new NextResponse(proposals, { status: 400 });
    const result = await prisma.$transaction(
      (tx) => receiveProposals(tx, auth.userId, proposals, newDate()),
      { timeout: 30_000 }
    );
    await tasksChanged(prisma, auth.userId, result.createdTaskIds);
    const { createdTaskIds, ...counts } = result;
    return NextResponse.json({ ...counts, tasks: createdTaskIds.length });
  } catch (error) {
    logger.error(
      "Failed to take proposals",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to take proposals" }, { status: 500 });
  }
}
