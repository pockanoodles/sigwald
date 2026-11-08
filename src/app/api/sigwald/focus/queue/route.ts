import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { enrichFocusTaskDisplay } from "@/lib/sigwald/enrich-focus-task";
import {
  buildFocusQueueCore,
  computeBriefingStripFromCore,
} from "@/lib/sigwald/focus-queue-core";

const LOG_SOURCE = "SigwaldFocusQueueAPI";

/**
 * GET /api/sigwald/focus/queue
 * Returns Stage 1–ranked open tasks (full rows + tags/project, plus what the
 * modules add to each), briefing strip, and display metadata, twice: `ranked`
 * is what to do next (resting work last, only what fits the free slot) and
 * `inventory` is every open task in its place, for Today.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;
    const now = newDate();

    const core = await buildFocusQueueCore(userId);
    const rowById = new Map(core.rows.map((r) => [r.id, r]));

    const toRow =
      (meta: typeof core.meta) => (t: (typeof core.ordered)[number]) => {
        const row = rowById.get(t.id);
        if (!row) {
          return [];
        }
        const m = meta.get(t.id);
        const rest = core.rests.get(t.id);
        const sigwald = {
          danger: m?.danger ?? false,
          urgencyTier: m?.urgencyTier ?? "NONE",
          baseScore: m?.baseScore ?? 0,
          // The moment it's due by (a date picked without a time runs to the
          // end of that day), for callers that act on deadlines (ops' pings).
          dueAt: t.dueDate ? new Date(t.dueDate).toISOString() : null,
          // Skipped or put off: Focus passes over it until then, Today marks it.
          resting: rest
            ? { reason: rest.reason, until: rest.until.toISOString() }
            : null,
          // Counted down to the moment it's due by, not the stored date.
          ...enrichFocusTaskDisplay(
            { ...row, dueDate: t.dueDate },
            now,
            core.timeZone
          ),
        };
        return [{ ...row, ...core.facts.get(t.id), sigwald }];
      };

    // `ranked` is what to do next (Focus, ops' top task); `inventory` is
    // everything open in its place (Today).
    const ranked = core.ordered.flatMap(toRow(core.meta));
    const inventory = core.inventory.flatMap(toRow(core.inventoryMeta));

    const briefing = computeBriefingStripFromCore(core, now);

    return NextResponse.json({ ranked, inventory, briefing });
  } catch (error) {
    logger.error(
      "Sigwald focus queue failed",
      { error: error instanceof Error ? error.message : "Unknown error" },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to load focus queue" },
      { status: 500 }
    );
  }
}
