/**
 * GET /api/sigwald/readouts: every reading of the last 90 days from the
 * modules this person has on, as readouts (src/modules/readouts/series.ts).
 */
import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { MODULES, isModuleId } from "@/modules";
import { moduleOffResponse } from "@/modules/api";
import { buildReadouts } from "@/modules/readouts/series";
import { moduleView } from "@/modules/state";

const LOG_SOURCE = "ReadoutsAPI";
const DAYS = 90;

export async function listReadouts(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if (auth.response || !auth.userId) return auth.response!;
    const off = await moduleOffResponse(auth.userId, "readouts");
    if (off) return off;
    const { isOn } = await moduleView(auth.userId);
    const rows = await prisma.moduleReading.findMany({
      where: {
        userId: auth.userId,
        day: { gte: new Date(Date.now() - DAYS * 86_400_000) },
      },
      orderBy: [{ day: "asc" }, { id: "asc" }],
    });
    const readouts = buildReadouts(
      rows
        .filter((r) => isModuleId(r.moduleId) && isOn(r.moduleId))
        .map((r) => ({
          module: r.moduleId,
          key: r.key,
          label: r.label,
          unit: r.unit,
          day: r.day.toISOString().slice(0, 10),
          value: r.value,
          at: r.at.toISOString(),
        })),
      MODULES.map((m) => m.id)
    );
    return NextResponse.json({ readouts });
  } catch (error) {
    logger.error(
      "Failed to list readouts",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to list readouts" },
      { status: 500 }
    );
  }
}
