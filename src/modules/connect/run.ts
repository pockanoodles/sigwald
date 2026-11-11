/**
 * Running a connector module's pull (server only): when it's due, with its
 * connection and settings, and what happens when it fails. The sync loop
 * calls this for everyone who has the module on; "Pull now" calls it with
 * `force`.
 *
 * A failed pull is recorded on the module, in words the connect pane shows,
 * and the next one waits twice as long (up to 12 hours), so a broken token
 * isn't asked about every 15 minutes. A refused token also marks the
 * connection, and every module reading through it waits until it's connected
 * again.
 */
import type { Prisma } from "@prisma/client";

import { createHttp } from "@/lib/connectors/egress";
import {
  ConnectorError,
  connectorProblem,
  isConnectorError,
} from "@/lib/connectors/errors";
import { NOTHING_LEAVES, policyFor } from "@/lib/connectors/policy";
import { needsAccount } from "@/lib/connectors/types";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { userTimeZone } from "@/lib/user-time-zone";

import { moduleById } from "@/modules";
import type { ModuleId } from "@/modules/types";

import { type PlanCounts, cleanResult } from "./plan";
import type { PullFn } from "./pull";
import { missingSettings, resolveSettings } from "./settings";
import { type ConnectSpec, DEFAULT_MAX_OPEN } from "./spec";
import { applyPull } from "./store";

const LOG_SOURCE = "ConnectorPull";
/** One pull gets this long, all its requests together. */
const PULL_DEADLINE_MS = 120_000;
const MAX_BACKOFF_MS = 12 * 60 * 60 * 1000;
/** A claim this old belongs to a pull that died: past its deadline, with room to write. */
const LEASE_MS = PULL_DEADLINE_MS + 60_000;

export interface PullOutcome {
  /** False when it wasn't due (or never pulls). */
  ran: boolean;
  ok?: boolean;
  /** Why it didn't work, in the words the pane shows. */
  problem?: string;
  counts?: PlanCounts;
  readings?: number;
}

function specOf(moduleId: ModuleId): ConnectSpec {
  const spec = moduleById(moduleId).connect;
  if (!spec) throw new Error(`${moduleId} isn't a connector module`);
  return spec;
}

/** How long after the last pull the next one is due: its interval, doubled per failure in a row. */
export function pullWait(spec: ConnectSpec, failures: number): number {
  const base = spec.everyMinutes * 60_000;
  return Math.min(
    base * 2 ** Math.min(failures, 10),
    Math.max(base, MAX_BACKOFF_MS)
  );
}

export function isPullDue(
  spec: ConnectSpec,
  sync: { lastPullAt: Date | null; failures: number } | null,
  now: Date
): boolean {
  if (spec.everyMinutes <= 0) return false;
  if (!sync?.lastPullAt) return true;
  return (
    now.getTime() - sync.lastPullAt.getTime() >= pullWait(spec, sync.failures)
  );
}

function asStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
}

function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  name: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new ConnectorError("network", `${name} took too long to read`)),
      ms
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function record(
  userId: string,
  moduleId: ModuleId,
  data: Prisma.ModuleSyncUncheckedUpdateInput
): Promise<void> {
  await prisma.moduleSync.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    create: {
      ...(data as Prisma.ModuleSyncUncheckedCreateInput),
      userId,
      moduleId,
    },
    update: data,
  });
}

/**
 * One person's pull of one module: if it's due (or `force`), read through
 * its connection and write what it saw. Never throws for the service's
 * failures (they're recorded); a bug in the pull itself is logged and
 * recorded too, so one broken module can't stop the sync loop's others.
 */
export async function runPull(
  userId: string,
  moduleId: ModuleId,
  pull: PullFn,
  options: { force?: boolean; now?: Date } = {}
): Promise<PullOutcome> {
  const spec = specOf(moduleId);
  const now = options.now ?? newDate();
  const before = await prisma.moduleSync.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
  });
  if (!options.force && !isPullDue(spec, before, now)) return { ran: false };

  // One pull per module at a time, from fetch to write: an older answer
  // written after a newer one would reopen what the newer one finished.
  if (!(await claim(userId, moduleId, now))) {
    return { ran: false, problem: "It's reading now. Try again in a moment." };
  }
  try {
    const sync = await prisma.moduleSync.findUnique({
      where: { userId_moduleId: { userId, moduleId } },
    });
    if (!options.force && !isPullDue(spec, sync, now)) return { ran: false };
    return await pullClaimed(userId, moduleId, pull, spec, sync, now);
  } finally {
    await prisma.moduleSync.updateMany({
      where: { userId, moduleId, pullingSince: now },
      data: { pullingSince: null },
    });
  }
}

/** Takes the module for one pull, unless another holds it (and hasn't outlived its lease). */
async function claim(
  userId: string,
  moduleId: ModuleId,
  now: Date
): Promise<boolean> {
  await prisma.moduleSync.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    create: { userId, moduleId },
    update: {},
  });
  const taken = await prisma.moduleSync.updateMany({
    where: {
      userId,
      moduleId,
      OR: [
        { pullingSince: null },
        { pullingSince: { lt: new Date(now.getTime() - LEASE_MS) } },
      ],
    },
    data: { pullingSince: now },
  });
  return taken.count === 1;
}

async function pullClaimed(
  userId: string,
  moduleId: ModuleId,
  pull: PullFn,
  spec: ConnectSpec,
  sync: Awaited<ReturnType<typeof prisma.moduleSync.findUnique>>,
  now: Date
): Promise<PullOutcome> {
  const manifest = moduleById(moduleId);
  const service = spec.service;
  const name = service?.name ?? manifest.name;
  const blocked = async (problem: string): Promise<PullOutcome> => {
    // Not a failure of the pull, so no backoff: it's waiting on the person.
    await record(userId, moduleId, { lastPullAt: now, error: problem });
    return { ran: true, ok: false, problem };
  };

  let secret: Record<string, string> = {};
  let config: Record<string, string> = {};
  if (service && needsAccount(service)) {
    const connection = await prisma.connection.findUnique({
      where: { userId_service: { userId, service: service.id } },
    });
    if (!connection?.secret)
      return blocked(`Connect ${service.name} to start.`);
    if (connection.error) return blocked(connection.error);
    try {
      secret = asStrings(JSON.parse(connection.secret));
    } catch {
      return blocked(
        `Connect ${service.name} again: its token couldn't be read.`
      );
    }
    config = asStrings(connection.config);
  }

  const settings = resolveSettings(spec.settings, sync?.settings);
  const missing = missingSettings(spec.settings, settings);
  if (missing.length > 0) return blocked(`Set ${missing.join(", ")} first.`);

  const timeZone = await userTimeZone(prisma, userId);
  const open = await prisma.moduleItem.findMany({
    where: { userId, moduleId, state: "open" },
    select: { externalId: true, kind: true, title: true },
  });
  const http = createHttp(
    service ? policyFor(service, config) : NOTHING_LEAVES
  );
  const maxOpen =
    typeof settings.maxOpen === "number"
      ? settings.maxOpen
      : (spec.maxOpen ?? DEFAULT_MAX_OPEN);

  try {
    const raw = await withDeadline(
      pull({
        http,
        secret,
        config,
        settings,
        now,
        timeZone,
        cursor: sync?.cursor ?? null,
        open: open.map((o) => ({
          externalId: o.externalId,
          kind: o.kind === "event" ? "event" : "task",
          title: o.title,
        })),
        lastSuccessAt: sync?.lastSuccessAt ?? null,
      }),
      PULL_DEADLINE_MS,
      name
    );
    const result = cleanResult(raw);
    const applied = await applyPull(userId, moduleId, result, {
      now,
      timeZone,
      maxOpen,
    });
    await record(userId, moduleId, {
      lastPullAt: now,
      lastSuccessAt: now,
      failures: 0,
      error: null,
      cursor: (result.cursor ?? null) as Prisma.InputJsonValue,
    });
    logger.info(
      "Module pull OK",
      {
        module: moduleId,
        requests: http.count,
        ...applied.counts,
        readings: applied.readings,
      },
      LOG_SOURCE
    );
    return {
      ran: true,
      ok: true,
      counts: applied.counts,
      readings: applied.readings,
    };
  } catch (error) {
    const problem = isConnectorError(error)
      ? connectorProblem(error, name)
      : `Something went wrong reading ${name}. It will try again later.`;
    if (isConnectorError(error) && error.kind === "auth" && service) {
      await prisma.connection.updateMany({
        where: { userId, service: service.id },
        data: { error: problem },
      });
    }
    await record(userId, moduleId, {
      lastPullAt: now,
      failures: (sync?.failures ?? 0) + 1,
      error: problem,
    });
    logger.error(
      "Module pull failed",
      {
        module: moduleId,
        kind: isConnectorError(error) ? error.kind : "bug",
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return { ran: true, ok: false, problem };
  }
}
