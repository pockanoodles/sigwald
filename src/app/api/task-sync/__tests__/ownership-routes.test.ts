import { NextRequest } from "next/server";

import { Prisma } from "@prisma/client";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/auth/api-auth", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: { count: jest.fn() },
    tag: { count: jest.fn() },
    goal: { count: jest.fn() },
    connectedAccount: { count: jest.fn() },
    taskProvider: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    taskListMapping: { findFirst: jest.fn(), update: jest.fn() },
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

function req(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
  });
}

const PROJECT = "3f2b8c1e-8f0a-4c55-9d2e-0a1b2c3d4e5f";

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ userId: "u1" });
  db.project.count.mockResolvedValue(1);
  db.connectedAccount.count.mockResolvedValue(1);
});

describe("POST /api/task-sync/providers", () => {
  const body = { name: "Outlook", type: "OUTLOOK", accountId: "acct-other" };

  it("refuses another user's connected account", async () => {
    db.connectedAccount.count.mockResolvedValue(0);
    const { POST } = await import("@/app/api/task-sync/providers/route");
    const res = await POST(req("/api/task-sync/providers", "POST", body));
    expect(res?.status).toBe(404);
    expect(db.connectedAccount.count).toHaveBeenCalledWith({
      where: { id: "acct-other", userId: "u1" },
    });
    expect(db.taskProvider.create).not.toHaveBeenCalled();
  });

  it("refuses another user's default project", async () => {
    db.project.count.mockResolvedValue(0);
    const { POST } = await import("@/app/api/task-sync/providers/route");
    const res = await POST(
      req("/api/task-sync/providers", "POST", {
        ...body,
        accountId: undefined,
        defaultProjectId: PROJECT,
      })
    );
    expect(res?.status).toBe(404);
    expect(db.taskProvider.create).not.toHaveBeenCalled();
  });

  it("answers 409 when a provider of that type exists", async () => {
    db.taskProvider.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    const { POST } = await import("@/app/api/task-sync/providers/route");
    const res = await POST(req("/api/task-sync/providers", "POST", body));
    expect(res?.status).toBe(409);
  });
});

describe("PATCH /api/task-sync/providers/[id]", () => {
  it("refuses another user's default project", async () => {
    db.taskProvider.findUnique.mockResolvedValue({
      id: "prov-1",
      userId: "u1",
    });
    db.project.count.mockResolvedValue(0);
    const { PATCH } = await import("@/app/api/task-sync/providers/[id]/route");
    const res = await PATCH(
      req("/api/task-sync/providers/prov-1", "PATCH", {
        defaultProjectId: PROJECT,
      }),
      { params: Promise.resolve({ id: "prov-1" }) }
    );
    expect(res?.status).toBe(404);
    expect(db.taskProvider.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/task-sync/mappings/[id]", () => {
  it("refuses to point a mapping at another user's project", async () => {
    db.taskListMapping.findFirst.mockResolvedValue({
      id: "map-1",
      provider: { userId: "u1" },
    });
    db.project.count.mockResolvedValue(0);
    const { PATCH } = await import("@/app/api/task-sync/mappings/[id]/route");
    const res = await PATCH(
      req("/api/task-sync/mappings/map-1", "PATCH", {
        projectId: PROJECT,
        direction: "outgoing",
      }),
      { params: Promise.resolve({ id: "map-1" }) }
    );
    expect(res?.status).toBe(404);
    expect(db.project.count).toHaveBeenCalledWith({
      where: { id: PROJECT, userId: "u1" },
    });
    expect(db.taskListMapping.update).not.toHaveBeenCalled();
  });
});
