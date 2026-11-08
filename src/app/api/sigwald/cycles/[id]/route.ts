import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { deactivateActiveCycles } from "@/lib/sigwald/goal-cycles";
import { sanitizeStatKeys } from "@/lib/sigwald/stats";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { moduleOffResponse } from "@/modules/api";

const LOG_SOURCE = "SigwaldCycleAPI";

/**
 * GET /api/sigwald/cycles/[id]
 * Returns a single cycle (with its goals) scoped to the authenticated user.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;

    const { id } = await params;
    const cycle = await prisma.goalCycle.findUnique({
      where: { id, userId: auth.userId },
      include: { goals: true },
    });

    if (!cycle) {
      return new NextResponse("Cycle not found", { status: 404 });
    }

    return NextResponse.json(cycle);
  } catch (error) {
    logger.error(
      "Error fetching goal cycle:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

/**
 * PUT /api/sigwald/cycles/[id]
 * Updates a cycle. Activating it (status "active") deactivates the current
 * active cycle to keep one active cycle per user. A Build the vault projected
 * (buildProjected) answers 409 to a change; its theme still edits here.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;

    const userId = auth.userId;
    const { id } = await params;

    const existing = await prisma.goalCycle.findUnique({
      where: { id, userId },
    });
    if (!existing) {
      return new NextResponse("Cycle not found", { status: 404 });
    }

    const json = await request.json();
    const { theme, startDate, endDate, status } = json;

    let focusStats: string[] | undefined;
    if (json.focusStats !== undefined) {
      const cleaned = sanitizeStatKeys(json.focusStats);
      if (cleaned === null) {
        return new NextResponse("focusStats must be a list of stat keys", {
          status: 400,
        });
      }
      focusStats = cleaned;
    }
    const changesBuild =
      focusStats !== undefined &&
      (focusStats.length !== existing.focusStats.length ||
        focusStats.some((key) => !existing.focusStats.includes(key)));
    if (changesBuild && existing.buildProjected) {
      return new NextResponse(
        "This hex's Build comes from the vault's map, so change it there",
        { status: 409 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (status === "active") {
        await deactivateActiveCycles(tx, userId, id);
      }
      return tx.goalCycle.update({
        where: { id, userId },
        data: {
          ...(theme !== undefined && { theme }),
          // A projected Build stays exactly as the vault sent it.
          ...(focusStats !== undefined && !existing.buildProjected && { focusStats }),
          ...(startDate !== undefined && { startDate: newDate(startDate) }),
          ...(endDate !== undefined && { endDate: newDate(endDate) }),
          ...(status !== undefined && { status }),
        },
      });
    });

    return NextResponse.json(updated);
  } catch (error) {
    // One cycle per person per hex (@@unique([userId, startDate, endDate])).
    if ((error as { code?: unknown } | null)?.code === "P2002") {
      return new NextResponse("A cycle already covers those dates", {
        status: 409,
      });
    }
    logger.error(
      "Error updating goal cycle:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

/**
 * DELETE /api/sigwald/cycles/[id]
 * Deletes a cycle (cascades to its goals; tasks keep their goalId set null).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;

    const userId = auth.userId;
    const { id } = await params;

    const existing = await prisma.goalCycle.findUnique({
      where: { id, userId },
    });
    if (!existing) {
      return new NextResponse("Cycle not found", { status: 404 });
    }

    await prisma.goalCycle.delete({ where: { id, userId } });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error(
      "Error deleting goal cycle:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
