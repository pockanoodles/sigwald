import { NextRequest } from "next/server";

import { receive } from "@/modules/inbox/routes";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  return receive(request, ctx);
}
