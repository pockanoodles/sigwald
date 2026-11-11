import { NextRequest } from "next/server";

import { deleteConnection, putConnection } from "@/modules/connect/routes";

type Ctx = { params: Promise<{ service: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  return putConnection(request, ctx);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return deleteConnection(request, ctx);
}
