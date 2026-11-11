import { NextRequest } from "next/server";

import { getModuleState, patchModuleSettings } from "@/modules/connect/routes";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return getModuleState(request, ctx);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return patchModuleSettings(request, ctx);
}
