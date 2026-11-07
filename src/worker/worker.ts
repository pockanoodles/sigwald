/**
 * The sync worker: Sigwald's background Canvas + CalDAV sync in its own
 * process, so it runs outside the web server and through app restarts.
 *
 * It runs the same loop as `SIGWALD_SCHEDULER=inprocess` (`lib/sigwald/sync-loop.ts`),
 * every `SIGWALD_BACKGROUND_SYNC_INTERVAL_MS` (default 15 minutes). Run this or
 * the in-process loop, not both.
 */

import "./load-env";

import { startSyncLoop } from "@/lib/sigwald/sync-loop";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "SigwaldWorker";

// The first tick waits a moment so a machine waking up has its network back.
startSyncLoop({ where: "worker", firstTickDelayMs: 5_000 });

const shutdown = async (signal: string) => {
  logger.info(`Sigwald worker ${signal}, exiting`, {}, LOG_SOURCE);
  // A sync cut short loses nothing: each step's writes and its activity land
  // together, and the next tick picks up from what Canvas returns.
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
