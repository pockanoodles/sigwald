import {
  ImportHttpError,
  importAccount,
  validateHeader,
} from "@/lib/account-export/import";
import { prisma } from "@/lib/prisma";

import { buildPrismaMock } from "./prisma-mock";

jest.mock("@/lib/prisma", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { buildPrismaMock } = require("./prisma-mock");
  return { prisma: buildPrismaMock() };
});

jest.mock("@/lib/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type MockPrisma = ReturnType<typeof buildPrismaMock>;
const db = prisma as unknown as MockPrisma;

const LOCAL_SCHEMA = "20261107120000_calendar_subscription";

function header(overrides: Record<string, unknown> = {}) {
  return {
    format: "sigwald-export",
    formatVersion: 1,
    schema: LOCAL_SCHEMA,
    app: "1.0.0",
    exportedAt: "2026-11-07T00:00:00.000Z",
    counts: {},
    ...overrides,
  };
}

describe("account import", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const fresh = buildPrismaMock();
    Object.assign(db.__tx, fresh.__tx);
    db.$transaction.mockImplementation(((fn: (t: typeof db.__tx) => unknown) =>
      fn(db.__tx)) as typeof db.$transaction);
    db.__tx.$queryRaw.mockResolvedValue([{ migration_name: LOCAL_SCHEMA }]);
  });

  it("rejects a bad format with 400", () => {
    expect(() =>
      validateHeader(header({ format: "other" }) as never, LOCAL_SCHEMA)
    ).toThrow(ImportHttpError);
    try {
      validateHeader(header({ format: "other" }) as never, LOCAL_SCHEMA);
    } catch (e) {
      expect(e).toBeInstanceOf(ImportHttpError);
      expect((e as ImportHttpError).status).toBe(400);
    }
  });

  it("rejects a newer schema with 409", () => {
    try {
      validateHeader(
        header({ schema: "20990101000000_future" }) as never,
        LOCAL_SCHEMA
      );
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ImportHttpError);
      expect((e as ImportHttpError).status).toBe(409);
      expect((e as ImportHttpError).message).toMatch(/newer Sigwald/);
    }
  });

  it("refuses a non-empty account with 409 and no writes", async () => {
    db.__tx.project.count.mockResolvedValue(2);

    await expect(
      importAccount("user-1", header() as never, [
        {
          m: "Project",
          r: {
            id: "p-1",
            name: "X",
            status: "active",
            userId: "old",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ])
    ).rejects.toMatchObject({ status: 409 });

    expect(db.__tx.project.createMany).not.toHaveBeenCalled();
  });

  it("rejects an excluded-model line", async () => {
    await expect(
      importAccount("user-1", header() as never, [
        {
          m: "Log",
          r: {
            id: "l-1",
            level: "INFO",
            message: "x",
            expiresAt: "2026-01-01T00:00:00.000Z",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        },
      ])
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a foreign reference not in the file", async () => {
    await expect(
      importAccount("user-1", header() as never, [
        {
          m: "Task",
          r: {
            id: "t-1",
            title: "A",
            status: "todo",
            userId: "old",
            projectId: "missing-project",
            skipCount: 0,
            timesSurfaced: 0,
            isAutoScheduled: false,
            scheduleLocked: false,
            isRecurring: false,
            skipSync: false,
            goalsPinned: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ])
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rewrites userId, converts DateTime, patches self-refs and connects tags in one transaction", async () => {
    const result = await importAccount("user-new", header() as never, [
      {
        m: "Tag",
        r: {
          id: "tag-1",
          name: "work",
          userId: "old",
        },
      },
      {
        m: "Task",
        r: {
          id: "t-parent",
          title: "Parent",
          status: "todo",
          userId: "old",
          parentTaskId: null,
          skipCount: 0,
          timesSurfaced: 0,
          isAutoScheduled: false,
          scheduleLocked: false,
          isRecurring: false,
          skipSync: false,
          goalsPinned: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          tagIds: [],
        },
      },
      {
        m: "Task",
        r: {
          id: "t-child",
          title: "Child",
          status: "todo",
          userId: "old",
          parentTaskId: "t-parent",
          dueDate: "2026-11-10T15:00:00.000Z",
          skipCount: 0,
          timesSurfaced: 0,
          isAutoScheduled: false,
          scheduleLocked: false,
          isRecurring: false,
          skipSync: false,
          goalsPinned: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          tagIds: ["tag-1"],
        },
      },
    ]);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.__tx.tag.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "tag-1",
          userId: "user-new",
        }),
      ],
    });

    const taskCreate = db.__tx.task.createMany.mock.calls[0][0].data as Record<
      string,
      unknown
    >[];
    expect(taskCreate).toHaveLength(2);
    expect(taskCreate[0]).toEqual(
      expect.objectContaining({ id: "t-parent", userId: "user-new" })
    );
    const child = taskCreate.find((r) => r.id === "t-child")!;
    expect(child.parentTaskId).toBeNull();
    expect(child.dueDate).toEqual(new Date("2026-11-10T15:00:00.000Z"));
    expect(child.userId).toBe("user-new");

    expect(db.__tx.task.update).toHaveBeenCalledWith({
      where: { id: "t-child" },
      data: { parentTaskId: "t-parent" },
    });
    expect(db.__tx.task.update).toHaveBeenCalledWith({
      where: { id: "t-child" },
      data: { tags: { connect: [{ id: "tag-1" }] } },
    });

    expect(result.counts.Task).toBe(2);
    expect(result.counts.Tag).toBe(1);
  });
});

describe("parseImportLines", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { gzipSync } = require("node:zlib") as typeof import("node:zlib");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require("node:stream") as typeof import("node:stream");
  const { parseImportLines } = jest.requireActual(
    "@/lib/account-export/import"
  ) as typeof import("@/lib/account-export/import");

  const file = (text: string) => gzipSync(Buffer.from(text));
  const lines = `${JSON.stringify(header())}\n${JSON.stringify({ m: "Tag", r: { id: "t1", name: "a" } })}\n`;

  it("reads the header and every line", async () => {
    const parsed = await parseImportLines(Readable.from([file(lines)]));
    expect(parsed.header.format).toBe("sigwald-export");
    expect(parsed.lines).toHaveLength(1);
  });

  it("refuses a truncated file instead of importing the lines before the break", async () => {
    const whole = file(lines + lines.split("\n")[1].repeat(200));
    const cut = whole.subarray(0, Math.floor(whole.length * 0.6));
    await expect(parseImportLines(Readable.from([cut]))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a file that expands past the limit", async () => {
    const big = file(
      lines +
        `${JSON.stringify({ m: "Tag", r: { id: "t2", name: "x".repeat(5000) } })}\n`
    );
    await expect(
      parseImportLines(Readable.from([big]), undefined, 1000)
    ).rejects.toMatchObject({
      status: 413,
    });
  });
});
