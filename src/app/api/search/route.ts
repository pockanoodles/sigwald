import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { searchEverything } from "@/lib/search/search";
import {
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  type SearchResponse,
} from "@/lib/search/types";

const LOG_SOURCE = "SearchAPI";

/**
 * GET /api/search?q=… — the top bar's search: tasks, events and what each
 * module that's on keeps, grouped, best first. Nothing leaves Sigwald.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request, LOG_SOURCE);
  if ("response" in auth) return auth.response;

  const text = (request.nextUrl.searchParams.get("q") ?? "")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
  if (text.length < SEARCH_MIN_LENGTH) {
    return NextResponse.json<SearchResponse>({ groups: [] });
  }

  try {
    const groups = await searchEverything(prisma, auth.userId, text);
    return NextResponse.json<SearchResponse>({ groups });
  } catch (error) {
    logger.error(
      "Search failed",
      { error: error instanceof Error ? error.message : "Unknown error" },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
