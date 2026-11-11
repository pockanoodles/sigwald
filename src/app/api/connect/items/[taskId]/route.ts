import { NextRequest } from "next/server";

import { getItemForTask } from "@/modules/connect/routes";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string }> }
) {
  return getItemForTask(request, ctx);
}
