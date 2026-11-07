import { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/auth/api-auth", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: { count: jest.fn() },
    tag: { count: jest.fn() },
    goal: { count: jest.fn() },
    connectedAccount: { count: jest.fn() },
    task: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    taskListMapping: { findFirst: jest.fn() },
    taskGoalLink: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(),
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
jest.mock("@/modules/hooks", () => ({
  moduleTaskFacts: jest.fn(async () => new Map()),
  tasksChanged: jest.fn(),
}));
jest.mock("@/modules/state", () => ({
  moduleView: jest.fn(async () => ({ isOn: () => true })),
  visibleSourceWhere: jest.fn(() => ({})),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function req(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ userId: "u1" });
  db.project.count.mockResolvedValue(1);
  db.tag.count.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length
  );
  db.goal.count.mockResolvedValue(1);
});

describe("POST /api/tasks", () => {
  it("refuses a project that isn't the caller's", async () => {
    db.project.count.mockResolvedValue(0);
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(
      req("/api/tasks", "POST", { title: "x", projectId: "their-project" })
    );
    expect(res?.status).toBe(404);
    expect(db.project.count).toHaveBeenCalledWith({
      where: { id: "their-project", userId: "u1" },
    });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("refuses a goal that isn't the caller's", async () => {
    db.goal.count.mockResolvedValue(0);
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(
      req("/api/tasks", "POST", { title: "x", goalId: "their-goal" })
    );
    expect(res?.status).toBe(404);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("refuses tags that aren't the caller's", async () => {
    db.tag.count.mockResolvedValue(0);
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(
      req("/api/tasks", "POST", { title: "x", tagIds: ["their-tag"] })
    );
    expect(res?.status).toBe(404);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("creates the task when every reference is the caller's", async () => {
    db.task.create.mockResolvedValue({ id: "t1", title: "x" });
    db.taskListMapping.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(
      req("/api/tasks", "POST", {
        title: "x",
        projectId: "my-project",
        tagIds: ["my-tag"],
      })
    );
    expect(res?.status).toBe(200);
    expect(db.task.create).toHaveBeenCalled();
  });
});

describe("PUT /api/tasks/[id]", () => {
  beforeEach(() => {
    db.task.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      projectId: null,
      tags: [],
      goalLinks: [],
      goalsPinned: false,
    });
  });

  it("refuses moving a task into a project that isn't the caller's", async () => {
    db.project.count.mockResolvedValue(0);
    const { PUT } = await import("@/app/api/tasks/[id]/route");
    const res = await PUT(
      req("/api/tasks/t1", "PUT", { projectId: "their-project" }),
      { params: Promise.resolve({ id: "t1" }) }
    );
    expect(res?.status).toBe(404);
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("refuses linking a goal that isn't the caller's", async () => {
    db.goal.count.mockResolvedValue(0);
    const { PUT } = await import("@/app/api/tasks/[id]/route");
    const res = await PUT(
      req("/api/tasks/t1", "PUT", { goalId: "their-goal" }),
      { params: Promise.resolve({ id: "t1" }) }
    );
    expect(res?.status).toBe(404);
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.taskGoalLink.create).not.toHaveBeenCalled();
  });
});
