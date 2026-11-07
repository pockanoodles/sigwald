import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { syncOutlookFeed } from "@/lib/outlook-sync";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEED_COLOR } from "@/lib/calendar-colors";

const LOG_SOURCE = "OutlookCalendarSyncAPI";

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST to sync calendars." },
    { status: 405 }
  );
}

// Shared sync function

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const body = await req.json();
    const { accountId, calendarId, name, color } = body;

    if (!accountId || !calendarId) {
      return NextResponse.json(
        { error: "Account ID and Calendar ID are required" },
        { status: 400 }
      );
    }

    // Get the account and ensure it belongs to the current user
    const account = await prisma.connectedAccount.findUnique({
      where: {
        id: accountId,
        userId,
      },
    });

    if (!account || account.provider !== "OUTLOOK") {
      return NextResponse.json(
        { error: "Invalid Outlook account" },
        { status: 400 }
      );
    }

    // Check if calendar already exists
    const existingFeed = await prisma.calendarFeed.findFirst({
      where: {
        type: "OUTLOOK",
        url: calendarId,
        accountId,
        userId,
      },
    });

    if (existingFeed) {
      return NextResponse.json(existingFeed);
    }

    // Create calendar feed
    const feed = await prisma.calendarFeed.create({
      data: {
        name,
        type: "OUTLOOK",
        url: calendarId,
        color: color || DEFAULT_FEED_COLOR,
        enabled: true,
        accountId: account.id,
        userId,
      },
    });

    // The feed stays even if its first sync fails: the failure is on
    // feed.error for the UI, and the sync loop tries again.
    try {
      await syncOutlookFeed(feed.id);
    } catch (error) {
      logger.error(
        "First sync of an added Outlook calendar failed",
        { feedId: feed.id, error: error instanceof Error ? error.message : String(error) },
        LOG_SOURCE
      );
    }

    return NextResponse.json(feed);
  } catch (error) {
    logger.error(
      "Failed to add Outlook calendar",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to add calendar" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const body = await req.json();
    const { feedId } = body;

    if (!feedId) {
      return NextResponse.json(
        { error: "Feed ID is required" },
        { status: 400 }
      );
    }

    // Get the feed and ensure it belongs to the current user
    const feed = await prisma.calendarFeed.findUnique({
      where: {
        id: feedId,
        userId,
      },
      include: { account: true },
    });

    if (!feed || !feed.account) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    if (feed.type !== "OUTLOOK" || !feed.url) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    const { events } = await syncOutlookFeed(feed.id);
    logger.debug(
      "Completed Outlook calendar sync",
      { feedId: String(feedId), processedEvents: String(events) },
      LOG_SOURCE
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      "Failed to sync Outlook calendar",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to sync calendar" },
      { status: 500 }
    );
  }
}
