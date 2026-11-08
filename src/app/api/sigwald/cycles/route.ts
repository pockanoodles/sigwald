import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { deactivateActiveCycles } from "@/lib/sigwald/goal-cycles";
import { sanitizeStatKeys } from "@/lib/sigwald/stats";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { moduleOffResponse } from "@/modules/api";

const LOG_SOURCE = "SigwaldCyclesAPI";

/**
 * GET /api/sigwald/cycles
 * Lists the authenticated user's goal cycles, newest first.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;

    const cycles = await prisma.goalCycle.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(cycles);
  } catch (error) {
    logger.error(
      "Error listing goal cycles:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

/**
 * POST /api/sigwald/cycles
 * Creates a goal cycle. Only one cycle can be active per user, so creating an
 * active cycle deactivates the current active one (marked "archived").
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "ladder");
    if (off) return off;

    const userId = auth.userId;
    const json = await request.json();
    const { theme, startDate, endDate, status } = json;

    if (!theme || !startDate || !endDate) {
      return new NextResponse("theme, startDate and endDate are required", {
        status: 400,
      });
    }

    const nextStatus = status ?? "active";

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

    const cycle = await prisma.$transaction(async (tx) => {
      if (nextStatus === "active") {
        await deactivateActiveCycles(tx, userId);
      }
      return tx.goalCycle.create({
        data: {
          theme,
          ...(focusStats !== undefined && { focusStats }),
          startDate: newDate(startDate),
          endDate: newDate(endDate),
          status: nextStatus,
          userId,
        },
      });
    });

    return NextResponse.json(cycle);
  } catch (error) {
    // One cycle per person per hex (@@unique([userId, startDate, endDate])).
    if ((error as { code?: unknown } | null)?.code === "P2002") {
      return new NextResponse("A cycle already covers those dates", {
        status: 409,
      });
    }
    logger.error(
      "Error creating goal cycle:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
