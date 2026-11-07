import { NextRequest, NextResponse } from "next/server";

import type { Auth } from "googleapis";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { createGoogleOAuthClient } from "@/lib/google";
import { appForNewConnection } from "@/lib/oauth/apps";
import { newCodeVerifier, startOAuth } from "@/lib/oauth/requests";

const LOG_SOURCE = "GoogleCalendarAuth";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request, LOG_SOURCE);
  if ("response" in auth) {
    return auth.response;
  }

  const app = await appForNewConnection("GOOGLE");
  if (!app) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/settings?error=google-not-available`
    );
  }

  const { state, codeChallenge } = await startOAuth({
    provider: "GOOGLE",
    app: app.kind,
    codeVerifier: newCodeVerifier(),
    redirectUri: app.redirectUri,
    userId: auth.userId,
  });

  const oauth2Client = await createGoogleOAuthClient(app);
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    // `calendar` already covers events; asking for `calendar.events` too only
    // added a line to the consent screen.
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/tasks",
    ],
    // `consent` every time, or Google omits the refresh token on a reconnect.
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    // The enum lives in googleapis, which this route doesn't load eagerly.
    code_challenge_method: "S256" as Auth.CodeChallengeMethod,
  });

  return NextResponse.redirect(url);
}
