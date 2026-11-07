import { NextRequest, NextResponse } from "next/server";

import { eraseAccount, isEraseConfirm } from "@/lib/account-export/erase";
import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";

const LOG_SOURCE = "account-erase-api";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;

    if (!body || !isEraseConfirm(body.confirm)) {
      return NextResponse.json(
        { error: 'Body must be { "confirm": "erase my data" }' },
        { status: 400 }
      );
    }

    await eraseAccount(auth.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error(
      "Error erasing account",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to erase account data" },
      { status: 500 }
    );
  }
}
