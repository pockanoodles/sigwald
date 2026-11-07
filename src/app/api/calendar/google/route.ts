import { NextRequest, NextResponse } from "next/server";

import { GaxiosError } from "gaxios";
import { v4 as uuidv4 } from "uuid";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGoogleCalendarClient } from "@/lib/google-calendar";
import { syncGoogleFeed, syncGoogleFeeds } from "@/lib/google-feed-sync";
import { logger } from "@/lib/logger";
import { oauthApp } from "@/lib/oauth/apps";
import { claimCallback } from "@/lib/oauth/callback";
import { finishOAuth } from "@/lib/oauth/finish";
import { prisma } from "@/lib/prisma";
import { TokenManager } from "@/lib/token-manager";

const LOG_SOURCE = "GoogleCalendarAPI";

// Handle Google OAuth callback and account connection. Who it is for comes
// from the sign-in's `state`, checked against the session on a server
// (see claimCallback).
export async function GET(request: NextRequest) {
  const claimed = await claimCallback(request, "GOOGLE", LOG_SOURCE);
  if ("response" in claimed) return claimed.response;
  const { pending } = claimed;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return finishOAuth("GOOGLE", {
      ok: false,
      code: "google-auth-declined",
      failure: "Google didn't give Sigwald access.",
    });
  }

  try {
    const app = await oauthApp("GOOGLE", pending.app);
    if (!app) throw new Error(`The ${pending.app} Google app isn't set up`);
    const oauth2Client = await createGoogleOAuthClient(app);
    const { userId } = pending;

    // Exchange code for tokens, on the exact redirect the sign-in left with
    const { tokens } = await oauth2Client.getToken({
      code,
      codeVerifier: pending.codeVerifier,
      redirect_uri: pending.redirectUri,
    });
    oauth2Client.setCredentials(tokens);

    const { google } = await import("googleapis");

    // Get user info to get email
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    if (!userInfo.data.email) {
      return finishOAuth("GOOGLE", {
        ok: false,
        code: "google-no-email",
        failure: "Google didn't share the account's email address.",
      });
    }

    // Store tokens
    const tokenManager = TokenManager.getInstance();
    const accountId = await tokenManager.storeTokens(
      "GOOGLE",
      userInfo.data.email,
      {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        // expiry_date from google-auth-library is an absolute epoch-ms
        // timestamp, not a duration. Adding Date.now() pushed expiry decades
        // out, so the token never refreshed and later calls 401'd silently.
        expiresAt: newDate(tokens.expiry_date || Date.now() + 3600 * 1000),
      },
      userId,
      app.kind
    );

    // Get list of calendars
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const calendarList = await calendar.calendarList.list();

    // Store calendars, then fill the new ones in the background: the redirect
    // shouldn't wait on Google, and the sync loop retries any that fail.
    const added: string[] = [];
    if (calendarList.data.items) {
      for (const cal of calendarList.data.items) {
        if (cal.id && cal.summary) {
          // Check if calendar feed already exists
          const existingFeed = await prisma.calendarFeed.findFirst({
            where: {
              type: "GOOGLE",
              url: cal.id,
              accountId,
              userId,
            },
          });

          // Only create if it doesn't exist
          if (!existingFeed) {
            const feed = await prisma.calendarFeed.create({
              data: {
                id: uuidv4(),
                name: cal.summary,
                url: cal.id,
                type: "GOOGLE",
                color: cal.backgroundColor ?? undefined,
                accountId,
                userId,
              },
            });
            added.push(feed.id);
          }
        }
      }
    }
    void syncGoogleFeeds(added);

    return finishOAuth("GOOGLE", { ok: true });
  } catch (error) {
    console.error("Google Calendar OAuth error:", error);
    return finishOAuth("GOOGLE", {
      ok: false,
      code: "google-auth-failed",
      failure: "Sigwald couldn't finish signing in to Google.",
    });
  }
}


export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { accountId, calendarId, name, color } = await request.json();

    if (!accountId || !calendarId) {
      return NextResponse.json(
        { error: "Account ID and Calendar ID are required" },
        { status: 400 }
      );
    }

    // Check if account belongs to the current user
    const account = await prisma.connectedAccount.findUnique({
      where: {
        id: accountId,
        userId,
      },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Check if calendar already exists
    const existingFeed = await prisma.calendarFeed.findFirst({
      where: {
        type: "GOOGLE",
        url: calendarId,
        accountId,
        userId,
      },
    });

    if (existingFeed) {
      return NextResponse.json(existingFeed);
    }

    const calendar = await getGoogleCalendarClient(accountId, userId);

    // Verify access to the calendar
    try {
      await calendar.calendars.get({ calendarId });
    } catch (error) {
      logger.warn(
        "Failed to access calendar",
        { calendarId, error: error instanceof Error ? error.message : String(error) },
        LOG_SOURCE
      );
      return NextResponse.json(
        { error: "Failed to access calendar" },
        { status: 403 }
      );
    }

    const feed = await prisma.calendarFeed.create({
      data: {
        id: uuidv4(),
        name,
        url: calendarId,
        type: "GOOGLE",
        color,
        accountId,
        userId,
      },
    });

    // The feed stays even if its first sync fails: the failure is on
    // feed.error for the UI, and the sync loop tries again.
    try {
      await syncGoogleFeed(feed.id);
    } catch (error) {
      logger.error(
        "First sync of an added Google calendar failed",
        { feedId: feed.id, error: error instanceof Error ? error.message : String(error) },
        LOG_SOURCE
      );
    }

    const fresh = await prisma.calendarFeed.findUnique({ where: { id: feed.id } });
    return NextResponse.json(fresh ?? feed);
  } catch (error) {
    logger.error(
      "Failed to add calendar",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to add calendar" },
      { status: 500 }
    );
  }
}

// Sync one calendar now (the feed list's sync button)
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const { feedId } = await request.json();
    if (!feedId) {
      return NextResponse.json(
        { error: "Feed ID is required" },
        { status: 400 }
      );
    }

    const feed = await prisma.calendarFeed.findUnique({
      where: { id: feedId, userId: auth.userId },
    });
    if (!feed || feed.type !== "GOOGLE" || !feed.accountId || !feed.url) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    await syncGoogleFeed(feed.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error(
      "Failed to sync Google calendar",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );

    if (error instanceof GaxiosError && Number(error.code) === 401) {
      return NextResponse.json(
        { error: "Authentication failed. Please try signing in again." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to sync calendar" },
      { status: 500 }
    );
  }
}
