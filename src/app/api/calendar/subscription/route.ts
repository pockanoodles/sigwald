import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newSubscriptionToken } from "@/lib/ical-out";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "CalendarSubscriptionAPI";

/**
 * GET → whether this user has a plan subscription, and its timestamps.
 * The raw token is never returned (it was shown once at create/rotate).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const sub = await prisma.calendarSubscription.findUnique({
      where: { userId: auth.userId },
      select: { createdAt: true, lastUsedAt: true },
    });

    if (!sub) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      createdAt: sub.createdAt.toISOString(),
      lastUsedAt: sub.lastUsedAt ? sub.lastUsedAt.toISOString() : null,
    });
  } catch (error) {
    logger.error(
      "Failed to fetch calendar subscription",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to fetch calendar subscription" },
      { status: 500 }
    );
  }
}

/**
 * POST → create or rotate the subscription token. Answers with the secret URL
 * once; only the hash is stored. Rotation makes the previous URL stop working.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const { token, tokenHash } = newSubscriptionToken();
    const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");

    await prisma.calendarSubscription.upsert({
      where: { userId: auth.userId },
      create: {
        userId: auth.userId,
        tokenHash,
      },
      update: {
        tokenHash,
        lastUsedAt: null,
      },
    });

    return NextResponse.json({
      url: `${base}/api/calendar/plan/${token}.ics`,
    });
  } catch (error) {
    logger.error(
      "Failed to create calendar subscription",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to create calendar subscription" },
      { status: 500 }
    );
  }
}

/** DELETE → remove the subscription; 204. */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    await prisma.calendarSubscription.deleteMany({
      where: { userId: auth.userId },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error(
      "Failed to delete calendar subscription",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to delete calendar subscription" },
      { status: 500 }
    );
  }
}
