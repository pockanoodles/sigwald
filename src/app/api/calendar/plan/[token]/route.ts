import { NextRequest, NextResponse } from "next/server";

import { buildPlanCalendar, hashToken } from "@/lib/ical-out";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "CalendarPlanFeedAPI";

const WINDOW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
const LAST_USED_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Public iCalendar feed for one user's plan. The token in the path is the
 * credential (calendar apps can't sign in). Never logs the token.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: raw } = await params;
    const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
    const tokenHash = hashToken(token);

    const sub = await prisma.calendarSubscription.findUnique({
      where: { tokenHash },
    });

    if (!sub) {
      return new NextResponse(null, { status: 404 });
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_BEFORE_MS);
    const windowEnd = new Date(now.getTime() + WINDOW_AFTER_MS);

    const [tasks, events] = await Promise.all([
      prisma.task.findMany({
        where: {
          userId: sub.userId,
          scheduledStart: { not: null, lt: windowEnd },
          scheduledEnd: { not: null, gt: windowStart },
          status: { not: "completed" },
        },
        select: {
          id: true,
          title: true,
          description: true,
          scheduledStart: true,
          scheduledEnd: true,
          updatedAt: true,
        },
      }),
      prisma.calendarEvent.findMany({
        where: {
          isMaster: false,
          start: { lt: windowEnd },
          end: { gt: windowStart },
          feed: {
            userId: sub.userId,
            enabled: true,
            type: "LOCAL",
          },
        },
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          start: true,
          end: true,
          allDay: true,
        },
      }),
    ]);

    const planTasks = tasks
      .filter(
        (
          t
        ): t is typeof t & {
          scheduledStart: Date;
          scheduledEnd: Date;
        } => t.scheduledStart != null && t.scheduledEnd != null
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        scheduledStart: t.scheduledStart,
        scheduledEnd: t.scheduledEnd,
        updatedAt: t.updatedAt,
      }));

    const ics = buildPlanCalendar({
      tasks: planTasks,
      events,
      now,
    });

    const lastUsedFresh =
      sub.lastUsedAt != null &&
      now.getTime() - sub.lastUsedAt.getTime() < LAST_USED_MIN_INTERVAL_MS;
    if (!lastUsedFresh) {
      await prisma.calendarSubscription.update({
        where: { id: sub.id },
        data: { lastUsedAt: now },
      });
    }

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": 'inline; filename="sigwald.ics"',
      },
    });
  } catch (error) {
    logger.error(
      "Failed to serve plan calendar",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse(null, { status: 500 });
  }
}
