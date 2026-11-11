import { NextRequest } from "next/server";

import { pullNow } from "@/modules/connect/routes";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return pullNow(request, ctx);
}
