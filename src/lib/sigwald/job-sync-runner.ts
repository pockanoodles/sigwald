/**
 * One tick of background sync (`sync-loop.ts`): CalDAV feeds, iCal
 * subscriptions, Google and Outlook calendars, then each module's jobs for
 * everyone who has that module on.
 */

import { CalDAVCalendarService } from "@/lib/caldav-calendar";
import { newDate } from "@/lib/date-utils";
import { isDue } from "@/lib/sigwald/sync-interval";
import { syncGoogleFeed } from "@/lib/google-feed-sync";
import { syncIcalFeed } from "@/lib/ical-feed";
import { logger } from "@/lib/logger";
import { syncOutlookFeed } from "@/lib/outlook-sync";
import { prisma } from "@/lib/prisma";

import { MODULES } from "@/modules";
import { SERVER_MODULES } from "@/modules/server";
import { usersWithModuleOn } from "@/modules/state";

const LOG_SOURCE = "SigwaldJobSyncRunner";

function caldavPollIntervalMs(): number {
  const raw = process.env.SIGWALD_CALDAV_POLL_INTERVAL_MINUTES;
  const mins = raw ? Number.parseInt(raw, 10) : 15;
  if (!Number.isFinite(mins) || mins < 1) {
    return 15 * 60_000;
  }
  return mins * 60_000;
}

/** Counts for one tick of a feed sync (CalDAV or iCal). */
export interface CaldavSyncRunStats {
  skipped: number;
  synced: number;
  failed: number;
}

/**
 * Syncs each enabled CalDAV feed whose last sync is older than the poll interval.
 */
export async function runPeriodicCaldavSyncs(): Promise<CaldavSyncRunStats> {
  const now = newDate();
  const pollMs = caldavPollIntervalMs();

  const feeds = await prisma.calendarFeed.findMany({
    where: {
      type: "CALDAV",
      enabled: true,
      url: { not: null },
      accountId: { not: null },
      userId: { not: null },
    },
    include: { account: true },
  });

  let skipped = 0;
  let synced = 0;
  let failed = 0;

  for (const feed of feeds) {
    if (!feed.account || !feed.url || !feed.userId) {
      skipped += 1;
      continue;
    }

    if (!isDue(feed.lastSync, now, pollMs)) {
      skipped += 1;
      continue;
    }

    try {
      const service = new CalDAVCalendarService(feed.account);
      await service.syncCalendar(feed.id, feed.url, feed.userId);
      await prisma.calendarFeed.update({
        where: { id: feed.id },
        data: { error: null },
      });
      synced += 1;
      logger.info(
        "CalDAV periodic sync OK",
        { feedId: feed.id, userId: feed.userId },
        LOG_SOURCE
      );
    } catch (error) {
      failed += 1;
      const msg =
        error instanceof Error ? error.message : String(error);
      logger.error(
        "CalDAV periodic sync failed",
        {
          feedId: feed.id,
          userId: feed.userId,
          error: msg,
        },
        LOG_SOURCE
      );
      await prisma.calendarFeed.update({
        where: { id: feed.id },
        data: { error: msg },
      });
    }
  }

  return { skipped, synced, failed };
}

/**
 * Syncs each enabled Google and Outlook calendar whose last sync is older than
 * the CalDAV poll interval. Both syncs read the provider before touching rows
 * and write a failure onto the feed, so a feed that fails keeps its events
 * and waits for the next tick.
 */
export async function runPeriodicProviderSyncs(): Promise<CaldavSyncRunStats> {
  const now = newDate();
  const pollMs = caldavPollIntervalMs();
  const feeds = await prisma.calendarFeed.findMany({
    where: {
      type: { in: ["GOOGLE", "OUTLOOK"] },
      enabled: true,
      url: { not: null },
      accountId: { not: null },
      userId: { not: null },
    },
    select: { id: true, type: true, lastSync: true, userId: true },
  });

  let skipped = 0;
  let synced = 0;
  let failed = 0;
  for (const feed of feeds) {
    if (!isDue(feed.lastSync, now, pollMs)) {
      skipped += 1;
      continue;
    }
    try {
      if (feed.type === "GOOGLE") await syncGoogleFeed(feed.id);
      else await syncOutlookFeed(feed.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        "Calendar periodic sync failed",
        {
          feedId: feed.id,
          type: feed.type,
          userId: feed.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        LOG_SOURCE
      );
    }
  }
  return { skipped, synced, failed };
}

/**
 * Re-reads each enabled iCal subscription whose last sync is older than the
 * CalDAV poll interval. `syncIcalFeed` writes a failure onto the feed and
 * keeps its last good events, so a feed that's down just waits for the next
 * tick.
 */
export async function runPeriodicIcalSyncs(): Promise<CaldavSyncRunStats> {
  const now = newDate();
  const pollMs = caldavPollIntervalMs();

  const feeds = await prisma.calendarFeed.findMany({
    where: {
      type: "ICAL",
      enabled: true,
      url: { not: null },
      userId: { not: null },
    },
  });

  let skipped = 0;
  let synced = 0;
  let failed = 0;

  for (const feed of feeds) {
    if (!feed.url || !feed.userId) {
      skipped += 1;
      continue;
    }
    if (!isDue(feed.lastSync, now, pollMs)) {
      skipped += 1;
      continue;
    }
    try {
      await syncIcalFeed({ id: feed.id, userId: feed.userId, url: feed.url });
      synced += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        "iCal periodic sync failed",
        {
          feedId: feed.id,
          userId: feed.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        LOG_SOURCE
      );
    }
  }

  return { skipped, synced, failed };
}

/**
 * Each module's jobs (src/modules/server.ts), for everyone who has that
 * module on. One person's failure is logged and doesn't stop the rest.
 */
export async function runModuleJobs(): Promise<{ ran: number; failed: number }> {
  let ran = 0;
  let failed = 0;
  for (const m of MODULES) {
    const jobs = SERVER_MODULES[m.id].jobs ?? [];
    if (jobs.length === 0) continue;
    for (const userId of await usersWithModuleOn(m.id)) {
      for (const job of jobs) {
        try {
          await job.run(userId);
          ran += 1;
        } catch (error) {
          failed += 1;
          logger.error(
            "Module job failed",
            {
              job: job.id,
              userId,
              error: error instanceof Error ? error.message : String(error),
            },
            LOG_SOURCE
          );
        }
      }
    }
  }
  return { ran, failed };
}

/**
 * One tick of the sync loop: CalDAV, iCal subscriptions, Google and Outlook
 * calendars, then every module's
 * jobs (Courses' Canvas sync among them, src/modules/courses/server.ts).
 */
export async function runAllPeriodicSigwaldSyncs(): Promise<{
  caldav: CaldavSyncRunStats;
  ical: CaldavSyncRunStats;
  providers: CaldavSyncRunStats;
  modules: { ran: number; failed: number };
}> {
  const caldav = await runPeriodicCaldavSyncs();
  const ical = await runPeriodicIcalSyncs();
  const providers = await runPeriodicProviderSyncs();
  const modules = await runModuleJobs();
  logger.info(
    "Sigwald periodic sync tick complete",
    {
      caldavSkipped: caldav.skipped,
      caldavSynced: caldav.synced,
      caldavFailed: caldav.failed,
      icalSynced: ical.synced,
      icalFailed: ical.failed,
      providerSynced: providers.synced,
      providerFailed: providers.failed,
      moduleJobsRan: modules.ran,
      moduleJobsFailed: modules.failed,
    },
    LOG_SOURCE
  );
  return { caldav, ical, providers, modules };
}
