/**
 * The connect API's handlers (server only). The route files under
 * src/app/api/connect only forward here.
 *
 * - PUT/DELETE /api/connect/connections/:service — connect a service (the
 *   token is checked with the service before it's kept) or disconnect it.
 * - GET/PATCH /api/connect/modules/:id — a connector module's state for its
 *   pane, and its settings.
 * - POST /api/connect/modules/:id/pull — pull now.
 * - GET /api/connect/items/:taskId — the pane for a task a module made.
 * - GET /api/connect/status — the readings the top bar shows.
 *
 * A secret goes in and never comes back out: no response carries one.
 */
import { NextRequest, NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { createHttp } from "@/lib/connectors/egress";
import { connectorProblem } from "@/lib/connectors/errors";
import { policyFor } from "@/lib/connectors/policy";
import { type ServiceManifest, needsAccount } from "@/lib/connectors/types";
import { VERIFIERS } from "@/lib/connectors/verifiers";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { isModuleId, moduleById } from "@/modules";
import { moduleOffResponse } from "@/modules/api";
import { pullModuleNow } from "@/modules/hooks";
import { moduleView } from "@/modules/state";
import type { ModuleId, ModuleManifest } from "@/modules/types";

import { parseConnectFields } from "./fields";
import type { Fact } from "./pull";
import { pullWait } from "./run";
import {
  applySettingsChange,
  missingSettings,
  resolveSettings,
} from "./settings";
import type { ConnectSpec } from "./spec";
import {
  type ConnectionView,
  type ItemPaneView,
  type ItemView,
  type ModuleConnectState,
  type ReadingView,
  type StatusReading,
  modulesUsing,
  serviceInUse,
} from "./views";

const LOG_SOURCE = "ConnectAPI";
/** "Pull now" waits this long after any pull, so a double click is one pull. */
const PULL_NOW_GAP_MS = 15_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Params<K extends string> = { params: Promise<Record<K, string>> };

function failed(message: string, error: unknown) {
  logger.error(
    message,
    { error: error instanceof Error ? error.message : String(error) },
    LOG_SOURCE
  );
  return NextResponse.json({ error: message }, { status: 500 });
}

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

function asStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
}

function connectionView(
  service: ServiceManifest,
  row: {
    accountLabel: string | null;
    error: string | null;
    verifiedAt: Date | null;
    config: unknown;
  }
): ConnectionView {
  const config = asStrings(row.config);
  const fields: Record<string, string> = {};
  for (const f of service.fields) {
    if (f.kind !== "secret" && config[f.key] !== undefined)
      fields[f.key] = config[f.key];
  }
  return {
    service: service.id,
    accountLabel: row.accountLabel,
    error: row.error,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    fields,
  };
}

/** The connector module a route names, and the person asking, or the response that says why not. */
async function connectorModule(
  request: NextRequest,
  id: string
): Promise<
  | { response: NextResponse }
  | { userId: string; manifest: ModuleManifest; spec: ConnectSpec }
> {
  const auth = await authenticateRequest(request, LOG_SOURCE);
  if (auth.response || !auth.userId) {
    return { response: auth.response ?? bad("Sign in first", 401) };
  }
  if (!isModuleId(id)) return { response: bad(`No module called ${id}`, 404) };
  const manifest = moduleById(id);
  if (!manifest.connect)
    return {
      response: bad(`${manifest.name} doesn't connect to anything`, 404),
    };
  const off = await moduleOffResponse(auth.userId, id);
  if (off) return { response: off };
  return { userId: auth.userId, manifest, spec: manifest.connect };
}

/** PUT /api/connect/connections/:service { fields } */
export async function putConnection(
  request: NextRequest,
  { params }: Params<"service">
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { service: serviceId } = await params;
    const service = serviceInUse(serviceId);
    const verify = VERIFIERS[serviceId];
    if (!service || !needsAccount(service) || !verify) {
      return bad(`Nothing connects to ${serviceId}`, 404);
    }
    const { isOn } = await moduleView(auth.userId);
    if (!modulesUsing(service.id).some((m) => isOn(m.id))) {
      return bad(`Turn on a module that reads ${service.name} first`, 409);
    }

    const parsed = parseConnectFields(
      service,
      await request.json().catch(() => null)
    );
    if ("problem" in parsed) return bad(parsed.problem);

    const http = createHttp(policyFor(service, parsed.config), {
      maxRequests: 5,
    });
    let verified;
    try {
      verified = await verify({
        http,
        secret: parsed.secret,
        config: parsed.config,
      });
    } catch (error) {
      return bad(connectorProblem(error, service.name));
    }

    const now = newDate();
    const data = {
      secret: JSON.stringify(parsed.secret),
      config: { ...parsed.config, ...verified.config } as Prisma.InputJsonValue,
      accountLabel: verified.label.slice(0, 200),
      error: null,
      verifiedAt: now,
    };
    const row = await prisma.connection.upsert({
      where: { userId_service: { userId: auth.userId, service: service.id } },
      create: { userId: auth.userId, service: service.id, ...data },
      update: data,
    });
    // Whatever was waiting on this connection may pull again at once.
    await prisma.moduleSync.updateMany({
      where: {
        userId: auth.userId,
        moduleId: { in: modulesUsing(service.id).map((m) => m.id) },
      },
      data: { failures: 0, error: null, lastPullAt: null },
    });
    logger.info("Service connected", { service: service.id }, LOG_SOURCE);
    return NextResponse.json({ connection: connectionView(service, row) });
  } catch (error) {
    return failed("Failed to connect", error);
  }
}

/** DELETE /api/connect/connections/:service — what its modules made stays. */
export async function deleteConnection(
  request: NextRequest,
  { params }: Params<"service">
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { service } = await params;
    await prisma.connection.deleteMany({
      where: { userId: auth.userId, service },
    });
    logger.info("Service disconnected", { service }, LOG_SOURCE);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failed("Failed to disconnect", error);
  }
}

async function moduleState(
  userId: string,
  moduleId: ModuleId,
  spec: ConnectSpec
): Promise<ModuleConnectState> {
  const now = newDate();
  const service = spec.service;
  const [sync, connection] = await Promise.all([
    prisma.moduleSync.findUnique({
      where: { userId_moduleId: { userId, moduleId } },
    }),
    service && needsAccount(service)
      ? prisma.connection.findUnique({
          where: { userId_service: { userId, service: service.id } },
          select: {
            accountLabel: true,
            error: true,
            verifiedAt: true,
            config: true,
          },
        })
      : null,
  ]);
  const settings = resolveSettings(spec.settings, sync?.settings);
  const where = { userId, moduleId };
  const [
    open,
    waiting,
    finishedThisWeek,
    upcoming,
    openItems,
    doneItems,
    readings,
  ] = await Promise.all([
    prisma.moduleItem.count({
      where: {
        ...where,
        kind: "task",
        state: "open",
        task: { status: { not: "completed" }, closedAt: null },
      },
    }),
    prisma.moduleItem.count({
      where: {
        ...where,
        kind: "task",
        state: "open",
        taskId: null,
        projectedAt: null,
      },
    }),
    prisma.moduleItem.count({
      where: {
        ...where,
        state: "done",
        doneAt: { gte: new Date(now.getTime() - WEEK_MS) },
      },
    }),
    prisma.moduleItem.count({
      where: {
        ...where,
        kind: "event",
        state: "open",
        event: { end: { gte: now } },
      },
    }),
    prisma.moduleItem.findMany({
      where: { ...where, state: "open" },
      orderBy: { lastSeenAt: "desc" },
      take: 40,
      include: {
        task: { select: { dueDate: true } },
        event: { select: { start: true } },
      },
    }),
    prisma.moduleItem.findMany({
      where: { ...where, state: "done" },
      orderBy: { doneAt: "desc" },
      take: 10,
      include: {
        task: { select: { dueDate: true } },
        event: { select: { start: true } },
      },
    }),
    prisma.moduleReading.findMany({
      where: {
        ...where,
        day: { gte: new Date(now.getTime() - WEEK_MS - 2 * 86_400_000) },
      },
      orderBy: { day: "desc" },
    }),
  ]);

  const items: ItemView[] = [...openItems, ...doneItems].map((i) => ({
    id: i.id,
    title: i.title,
    url: i.url,
    kind: i.kind === "event" ? "event" : "task",
    state: i.state === "done" ? "done" : i.state === "gone" ? "gone" : "open",
    taskId: i.taskId,
    when: (i.task?.dueDate ?? i.event?.start)?.toISOString() ?? null,
    doneAt: i.doneAt?.toISOString() ?? null,
  }));

  const latest = new Map<string, ReadingView>();
  for (const r of readings) {
    if (latest.has(r.key)) continue;
    // Only a reading in the same unit compares: a currency change starts over.
    const weekAgo = readings.find(
      (o) =>
        o.key === r.key &&
        o.unit === r.unit &&
        r.day.getTime() - o.day.getTime() >= WEEK_MS
    );
    latest.set(r.key, {
      key: r.key,
      label: r.label,
      unit: r.unit,
      value: r.value,
      at: r.at.toISOString(),
      weekAgo: weekAgo?.value ?? null,
    });
  }

  const next =
    spec.everyMinutes > 0
      ? new Date(
          (sync?.lastPullAt?.getTime() ?? now.getTime()) +
            (sync?.lastPullAt ? pullWait(spec, sync.failures) : 0)
        )
      : null;
  return {
    module: moduleId,
    connection:
      service && connection ? connectionView(service, connection) : null,
    settings,
    missing: missingSettings(spec.settings, settings),
    lastPullAt: sync?.lastPullAt?.toISOString() ?? null,
    lastSuccessAt: sync?.lastSuccessAt?.toISOString() ?? null,
    nextPullAt: next?.toISOString() ?? null,
    error: sync?.error ?? null,
    counts: { open, waiting, finishedThisWeek, upcoming },
    items,
    readings: [...latest.values()],
  };
}

/** GET /api/connect/modules/:id */
export async function getModuleState(
  request: NextRequest,
  { params }: Params<"id">
) {
  try {
    const found = await connectorModule(request, (await params).id);
    if ("response" in found) return found.response;
    return NextResponse.json(
      await moduleState(found.userId, found.manifest.id, found.spec)
    );
  } catch (error) {
    return failed("Failed to read the module", error);
  }
}

/** PATCH /api/connect/modules/:id { settings } */
export async function patchModuleSettings(
  request: NextRequest,
  { params }: Params<"id">
) {
  try {
    const found = await connectorModule(request, (await params).id);
    if ("response" in found) return found.response;
    const { userId, manifest, spec } = found;
    const body = (await request.json().catch(() => null)) as {
      settings?: unknown;
    } | null;
    const sync = await prisma.moduleSync.findUnique({
      where: { userId_moduleId: { userId, moduleId: manifest.id } },
      select: { settings: true },
    });
    const applied = applySettingsChange(
      spec.settings,
      sync?.settings,
      body?.settings
    );
    if ("problem" in applied) return bad(applied.problem);
    const settings = applied.settings as Prisma.InputJsonValue;
    // New settings read again at once: the next tick pulls.
    await prisma.moduleSync.upsert({
      where: { userId_moduleId: { userId, moduleId: manifest.id } },
      create: { userId, moduleId: manifest.id, settings },
      update: { settings, lastPullAt: null, failures: 0, error: null },
    });
    return NextResponse.json(await moduleState(userId, manifest.id, spec));
  } catch (error) {
    return failed("Failed to save the settings", error);
  }
}

/** POST /api/connect/modules/:id/pull */
export async function pullNow(request: NextRequest, { params }: Params<"id">) {
  try {
    const found = await connectorModule(request, (await params).id);
    if ("response" in found) return found.response;
    const { userId, manifest, spec } = found;
    if (spec.everyMinutes <= 0)
      return bad(`${manifest.name} doesn't pull: things are sent to it`, 409);
    const sync = await prisma.moduleSync.findUnique({
      where: { userId_moduleId: { userId, moduleId: manifest.id } },
      select: { lastPullAt: true },
    });
    if (
      sync?.lastPullAt &&
      Date.now() - sync.lastPullAt.getTime() < PULL_NOW_GAP_MS
    ) {
      return bad("It just pulled. Try again in a moment.", 429);
    }
    const outcome = await pullModuleNow(userId, manifest.id);
    return NextResponse.json({
      outcome,
      state: await moduleState(userId, manifest.id, spec),
    });
  } catch (error) {
    return failed("Failed to pull", error);
  }
}

/** GET /api/connect/items/:taskId */
export async function getItemForTask(
  request: NextRequest,
  { params }: Params<"taskId">
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { taskId } = await params;
    const item = await prisma.moduleItem.findFirst({
      where: { taskId, userId: auth.userId },
    });
    if (!item || !isModuleId(item.moduleId)) return bad("No such item", 404);
    const off = await moduleOffResponse(auth.userId, item.moduleId);
    if (off) return off;
    const view: ItemPaneView = {
      module: item.moduleId,
      title: item.title,
      url: item.url,
      state:
        item.state === "done"
          ? "done"
          : item.state === "gone"
            ? "gone"
            : "open",
      facts: Array.isArray(item.facts) ? (item.facts as unknown as Fact[]) : [],
      updatedAt: item.upstreamUpdatedAt?.toISOString() ?? null,
      seenAt: item.lastSeenAt.toISOString(),
    };
    return NextResponse.json(view);
  } catch (error) {
    return failed("Failed to read the item", error);
  }
}

/** GET /api/connect/status — each on module's headline reading, where its "Show in the top bar" is on. */
export async function getStatusReadings(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { isOn } = await moduleView(auth.userId);
    const syncs = await prisma.moduleSync.findMany({
      where: { userId: auth.userId },
      select: { moduleId: true, settings: true },
    });
    const shown = syncs.flatMap((s) => {
      if (!isModuleId(s.moduleId) || !isOn(s.moduleId)) return [];
      const spec = moduleById(s.moduleId).connect;
      if (!spec?.makes.includes("readings")) return [];
      return resolveSettings(spec.settings, s.settings).status === true
        ? [{ id: s.moduleId, spec }]
        : [];
    });
    const readings: StatusReading[] = [];
    for (const { id, spec } of shown) {
      const latest = await prisma.moduleReading.findFirst({
        where: {
          userId: auth.userId,
          moduleId: id,
          ...(spec.headline ? { key: spec.headline } : {}),
        },
        orderBy: [{ day: "desc" }, { id: "asc" }],
      });
      if (latest)
        readings.push({
          module: id,
          label: latest.label,
          unit: latest.unit,
          value: latest.value,
        });
    }
    return NextResponse.json({ readings });
  } catch (error) {
    return failed("Failed to read the status", error);
  }
}
