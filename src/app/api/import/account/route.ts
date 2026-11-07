import { NextRequest, NextResponse } from "next/server";

import {
  ImportHttpError,
  importAccountFromStream,
} from "@/lib/account-export/import";
import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";

const LOG_SOURCE = "import-account-api";
const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file field" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 200 MB)" },
        { status: 413 }
      );
    }

    const result = await importAccountFromStream(
      auth.userId,
      file.stream(),
      file.size
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ImportHttpError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    logger.error(
      "Error importing account",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to import account" },
      { status: 500 }
    );
  }
}
