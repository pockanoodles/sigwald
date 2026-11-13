import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { buildMaterialManifest } from "@/lib/canvas/material-manifest";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { moduleOffResponse } from "@/modules/api";

const LOG_SOURCE = "SigwaldMaterialManifestAPI";

/**
 * GET /api/sigwald/materials/files
 * The materials cache as a manifest: every course with its folder alias, and
 * every cached file with its path inside the cache, its size on disk and when
 * Canvas last changed it. A copy of the cache kept elsewhere diffs itself
 * against this and fetches what changed through ../[id]/file.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const off = await moduleOffResponse(auth.userId, "courses");
    if (off) return off;
    const courses = await prisma.course.findMany({
      where: { userId: auth.userId },
      orderBy: { name: "asc" },
      select: {
        canvasId: true,
        code: true,
        materials: {
          where: { kind: "FILE", localPath: { not: null } },
          orderBy: { id: "asc" },
          select: { id: true, fileCanvasId: true, fileName: true, fileUpdatedAt: true, localPath: true },
        },
      },
    });
    return NextResponse.json(await buildMaterialManifest(courses));
  } catch (error) {
    logger.error(
      "Sigwald material manifest failed",
      { error: error instanceof Error ? error.message : "Unknown error" },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to list cached files" }, { status: 500 });
  }
}
