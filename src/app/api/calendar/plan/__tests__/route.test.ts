import { createHash } from "node:crypto";

import { hashToken } from "@/lib/ical-out";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    calendarSubscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    calendarEvent: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const TOKEN = "test-subscription-token-value";
const TOKEN_HASH = hashToken(TOKEN);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/calendar/plan/[token]", () => {
  it("returns 404 with an empty body for an unknown token", async () => {
    const { GET } = await import("@/app/api/calendar/plan/[token]/route");
    db.calendarSubscription.findUnique.mockResolvedValue(null);

    const res = await GET({} as never, {
      params: Promise.resolve({ token: "nope.ics" }),
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it("accepts a .ics suffix and returns text/calendar containing the task", async () => {
    const { GET } = await import("@/app/api/calendar/plan/[token]/route");
    db.calendarSubscription.findUnique.mockResolvedValue({
      id: "sub-1",
      userId: "user-1",
      tokenHash: TOKEN_HASH,
      lastUsedAt: null,
    });
    db.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        title: "Deep work",
        description: null,
        scheduledStart: new Date(Date.UTC(2026, 10, 8, 14, 0, 0)),
        scheduledEnd: new Date(Date.UTC(2026, 10, 8, 15, 0, 0)),
        updatedAt: new Date(Date.UTC(2026, 10, 7, 10, 0, 0)),
      },
    ]);
    db.calendarEvent.findMany.mockResolvedValue([]);
    db.calendarSubscription.update.mockResolvedValue({});

    const res = await GET({} as never, {
      params: Promise.resolve({ token: `${TOKEN}.ics` }),
    });

    expect(db.calendarSubscription.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: TOKEN_HASH },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8"
    );
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="sigwald.ics"'
    );
    const body = await res.text();
    expect(body).toContain("UID:task-task-1@sigwald");
    expect(body).toContain("SUMMARY:Deep work");
  });

  it("excludes completed tasks and non-LOCAL feeds via the prisma where clauses", async () => {
    const { GET } = await import("@/app/api/calendar/plan/[token]/route");
    db.calendarSubscription.findUnique.mockResolvedValue({
      id: "sub-1",
      userId: "user-1",
      tokenHash: TOKEN_HASH,
      lastUsedAt: new Date(),
    });
    db.task.findMany.mockResolvedValue([]);
    db.calendarEvent.findMany.mockResolvedValue([]);

    await GET({} as never, {
      params: Promise.resolve({ token: TOKEN }),
    });

    const taskWhere = db.task.findMany.mock.calls[0][0].where;
    expect(taskWhere.userId).toBe("user-1");
    expect(taskWhere.status).toEqual({ not: "completed" });
    expect(taskWhere.scheduledStart).toEqual(
      expect.objectContaining({ not: null })
    );
    expect(taskWhere.scheduledEnd).toEqual(
      expect.objectContaining({ not: null })
    );

    const eventWhere = db.calendarEvent.findMany.mock.calls[0][0].where;
    expect(eventWhere.isMaster).toBe(false);
    expect(eventWhere.feed).toEqual({
      userId: "user-1",
      enabled: true,
      type: "LOCAL",
    });
  });
});

describe("hashToken consistency used by the feed route", () => {
  it("matches node crypto sha256 hex of the raw token", () => {
    const expected = createHash("sha256").update(TOKEN).digest("hex");
    expect(hashToken(TOKEN)).toBe(expected);
  });
});
