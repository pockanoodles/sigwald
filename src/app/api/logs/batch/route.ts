import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { ServerLogger } from "@/lib/logger/server";
import { LogEntry, LogLevel } from "@/lib/logger/types";

const LOG_SOURCE = "LogBatchAPI";

const MAX_ENTRIES = 100;
const MAX_MESSAGE_CHARS = 2000;
const MAX_SOURCE_CHARS = 200;
const MAX_METADATA_BYTES = 10 * 1024;

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** Validate one client entry and clamp its free-text fields; null if unusable. */
function normalizeEntry(raw: unknown): LogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;

  if (typeof e.message !== "string" || !LEVELS.includes(e.level as LogLevel)) {
    return null;
  }

  const timestamp = new Date(e.timestamp as string);
  if (Number.isNaN(timestamp.getTime())) return null;

  let metadata: LogEntry["metadata"] = undefined;
  if (e.metadata && typeof e.metadata === "object") {
    const serialized = JSON.stringify(e.metadata);
    // Oversized metadata is dropped, not truncated: cutting JSON mid-string
    // would store something that no longer parses.
    if (serialized.length <= MAX_METADATA_BYTES) {
      metadata = e.metadata as LogEntry["metadata"];
    }
  }

  return {
    level: e.level as LogLevel,
    message: e.message.slice(0, MAX_MESSAGE_CHARS),
    metadata,
    source:
      typeof e.source === "string"
        ? e.source.slice(0, MAX_SOURCE_CHARS)
        : undefined,
    timestamp,
  };
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request, LOG_SOURCE);
  if ("response" in auth) return auth.response;

  try {
    const body: unknown = await request.json();

    if (!Array.isArray(body) || body.length > MAX_ENTRIES) {
      return NextResponse.json(
        { error: `Body must be an array of at most ${MAX_ENTRIES} entries` },
        { status: 400 }
      );
    }

    const entries = body
      .map(normalizeEntry)
      .filter((e): e is LogEntry => e !== null);

    const logger = new ServerLogger();
    const result = await logger.writeBatch(entries);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to process batch logs:", error);
    return NextResponse.json(
      { error: "Failed to process logs" },
      { status: 500 }
    );
  }
}
