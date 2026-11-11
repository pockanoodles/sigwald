/**
 * The Inbox's HTTP handlers. Its private address is the only route in
 * Sigwald a stranger's request can reach with something to write, so it
 * takes little and checks everything: the token in the path is the
 * credential (stored only as its SHA-256), the body is at most 64 KB and 50
 * items, every field is checked (src/modules/inbox/receive.ts), and a full
 * Inbox says so instead of growing.
 *
 * - GET/POST/DELETE /api/sigwald/inbox/link (signed in): whether there's an
 *   address, make or replace it (shown once), turn it off.
 * - POST /api/sigwald/inbox/in/:token: send work.
 */
import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { hashToken, newSubscriptionToken } from "@/lib/ical-out";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { publicUrl } from "@/lib/public-url";
import { userTimeZone } from "@/lib/user-time-zone";

import { moduleOffResponse } from "@/modules/api";
import { cleanResult } from "@/modules/connect/plan";
import { applyPull } from "@/modules/connect/store";
import { MAX_BODY_BYTES, parseInbox } from "@/modules/inbox/receive";

const LOG_SOURCE = "InboxAPI";
const MODULE = "inbox" as const;
/** Open items past which it takes no new work until some is done. */
const MAX_OPEN_ITEMS = 500;
const LAST_USED_EVERY_MS = 10 * 60 * 1000;

function failed(message: string, error: unknown) {
  logger.error(
    message,
    { error: error instanceof Error ? error.message : String(error) },
    LOG_SOURCE
  );
  return NextResponse.json({ error: message }, { status: 500 });
}

async function signedIn(request: NextRequest) {
  const auth = await authenticateRequest(request, LOG_SOURCE);
  if (auth.response || !auth.userId) return { response: auth.response! };
  const off = await moduleOffResponse(auth.userId, MODULE);
  return off ? { response: off } : { userId: auth.userId };
}

const linkPath = (token: string) => `/api/sigwald/inbox/in/${token}`;

/** GET /api/sigwald/inbox/link */
export async function getLink(request: NextRequest) {
  try {
    const auth = await signedIn(request);
    if ("response" in auth) return auth.response;
    const link = await prisma.inboundLink.findUnique({
      where: { userId_moduleId: { userId: auth.userId, moduleId: MODULE } },
      select: { createdAt: true, lastUsedAt: true },
    });
    return NextResponse.json({
      link: link
        ? {
            createdAt: link.createdAt.toISOString(),
            lastUsedAt: link.lastUsedAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (error) {
    return failed("Failed to read the Inbox address", error);
  }
}

/** POST /api/sigwald/inbox/link — a new address; any old one stops working. */
export async function makeLink(request: NextRequest) {
  try {
    const auth = await signedIn(request);
    if ("response" in auth) return auth.response;
    const { token, tokenHash } = newSubscriptionToken();
    const link = await prisma.inboundLink.upsert({
      where: { userId_moduleId: { userId: auth.userId, moduleId: MODULE } },
      create: { userId: auth.userId, moduleId: MODULE, tokenHash },
      update: { tokenHash, createdAt: newDate(), lastUsedAt: null },
    });
    logger.info("Inbox address made", {}, LOG_SOURCE);
    return NextResponse.json({
      url: publicUrl(linkPath(token), request).toString(),
      link: { createdAt: link.createdAt.toISOString(), lastUsedAt: null },
    });
  } catch (error) {
    return failed("Failed to make the Inbox address", error);
  }
}

/** DELETE /api/sigwald/inbox/link — what was sent stays. */
export async function deleteLink(request: NextRequest) {
  try {
    const auth = await signedIn(request);
    if ("response" in auth) return auth.response;
    await prisma.inboundLink.deleteMany({
      where: { userId: auth.userId, moduleId: MODULE },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failed("Failed to turn the Inbox address off", error);
  }
}

/** POST /api/sigwald/inbox/in/:token */
export async function receive(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const link = /^[A-Za-z0-9_-]{20,100}$/.test(token)
      ? await prisma.inboundLink.findUnique({
          where: { tokenHash: hashToken(token) },
        })
      : null;
    // Never says whether an address was ever real.
    if (!link || link.moduleId !== MODULE)
      return new NextResponse(null, { status: 404 });
    const off = await moduleOffResponse(link.userId, MODULE);
    if (off) return off;

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Send at most 64 KB at a time" },
        { status: 413 }
      );
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Send at most 64 KB at a time" },
        { status: 413 }
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Send JSON" }, { status: 400 });
    }

    const now = newDate();
    const parsed = parseInbox(body, now);
    if ("problem" in parsed)
      return NextResponse.json({ error: parsed.problem }, { status: 400 });

    // What's still asked of the person: open here and not yet done by hand
    // (or, for a time, not yet over). A retry or an update of something
    // already sent adds nothing.
    const active = await prisma.moduleItem.count({
      where: {
        userId: link.userId,
        moduleId: MODULE,
        state: "open",
        OR: [
          { task: { status: { not: "completed" }, closedAt: null } },
          { event: { end: { gte: now } } },
        ],
      },
    });
    const known = new Set(
      (
        await prisma.moduleItem.findMany({
          where: {
            userId: link.userId,
            moduleId: MODULE,
            externalId: { in: parsed.items.map((i) => i.externalId) },
          },
          select: { externalId: true },
        })
      ).map((i) => i.externalId)
    );
    const adding = parsed.items.filter(
      (i) => i.state === "open" && !known.has(i.externalId)
    ).length;
    if (active + adding > MAX_OPEN_ITEMS) {
      return NextResponse.json(
        {
          error: `The Inbox holds ${open} open items; finish some before sending more`,
        },
        { status: 429 }
      );
    }

    const applied = await applyPull(
      link.userId,
      MODULE,
      cleanResult({ items: parsed.items, complete: false }),
      {
        now,
        timeZone: await userTimeZone(prisma, link.userId),
        // Nothing sent waits for room: the admission check above bounds it.
        maxOpen: Number.MAX_SAFE_INTEGER,
      }
    );
    if (
      !link.lastUsedAt ||
      now.getTime() - link.lastUsedAt.getTime() > LAST_USED_EVERY_MS
    ) {
      await prisma.inboundLink.update({
        where: { id: link.id },
        data: { lastUsedAt: now },
      });
    }
    return NextResponse.json({
      received: parsed.items.length,
      created: applied.counts.created,
      finished: applied.counts.finished,
      waiting: applied.counts.waiting,
    });
  } catch (error) {
    return failed("Failed to take what was sent", error);
  }
}
