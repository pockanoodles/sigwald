/**
 * What every full feed sync shares (lib/google-feed-sync.ts, lib/outlook-sync.ts):
 * stable row ids, and a per-feed lock around the replace.
 */
import { v5 as uuidv5 } from "uuid";

import type { Prisma } from "@prisma/client";

/**
 * The same provider event in the same feed always gets the same row id, so an
 * event keeps its id across syncs and a calendar left open can still edit or
 * delete it.
 */
export function eventRowId(feedId: string, externalId: string): string {
  return uuidv5(externalId, uuidv5(feedId, uuidv5.URL));
}

/**
 * Holds the feed until the transaction ends. Without it, two full syncs of one
 * feed (a background tick and the sync button) interleave: the second one's
 * delete can't see the first one's new rows, and its inserts then collide with
 * them on the stable ids.
 */
export async function lockFeed(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  feedId: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${feedId}))`;
}
