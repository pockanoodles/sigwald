import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { cleanCanvasHtml } from "@/lib/canvas/clean-html";
import { cleanOptionsFor } from "@/lib/canvas/material-html";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { moduleOffResponse } from "@/modules/api";
import type { NewsItem, NewsMessage } from "@/types/course-activity";

const LOG_SOURCE = "SigwaldNewsAPI";

/**
 * GET /api/sigwald/news[?courseId=<Sigwald course id>]
 *
 * What instructors said: course announcements (sanitized, links re-pointed at
 * the local mirror) and Canvas Inbox threads, newest first, each flagged when
 * its activity hasn't been seen. Every course, or the one asked for.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "courses");
    if (off) return off;
    const courseId = request.nextUrl.searchParams.get("courseId");
    const courses = await prisma.course.findMany({
      where: { userId: auth.userId, ...(courseId ? { id: courseId } : {}) },
      select: {
        id: true,
        canvasId: true,
        code: true,
        name: true,
        announcements: {
          orderBy: { postedAt: "desc" },
          include: { activity: { where: { seenAt: null }, select: { id: true } } },
        },
        conversations: {
          orderBy: { lastMessageAt: "desc" },
          include: { activity: { where: { seenAt: null }, select: { id: true } } },
        },
      },
    });

    const items: NewsItem[] = [];
    for (const c of courses) {
      const course = { id: c.id, canvasId: c.canvasId, code: c.code, name: c.name };
      const clean = await cleanOptionsFor(auth.userId, c.canvasId);
      for (const a of c.announcements) {
        items.push({
          type: "announcement",
          id: a.id,
          course,
          title: a.title,
          author: a.author,
          at: a.postedAt.toISOString(),
          htmlUrl: a.htmlUrl,
          bodyHtml: cleanCanvasHtml(a.bodyHtml, clean),
          readInCanvas: a.readInCanvas,
          unseen: a.activity.length > 0,
        });
      }
      for (const t of c.conversations) {
        const messages = (Array.isArray(t.messages) ? t.messages : []) as NewsMessage["messages"];
        items.push({
          type: "message",
          id: t.id,
          course,
          title: t.subject,
          author: messages.find((m) => !m.mine)?.author ?? null,
          at: t.lastMessageAt.toISOString(),
          messages,
          unseen: t.activity.length > 0,
        });
      }
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json(items);
  } catch (error) {
    logger.error(
      "Sigwald news failed",
      { error: error instanceof Error ? error.message : "Unknown error" },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to load news" }, { status: 500 });
  }
}
