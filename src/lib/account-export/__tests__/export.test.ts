import { gunzipSync } from "node:zlib";

import { serializeExportRow } from "@/lib/account-export/export";
import { exportAccountStream } from "@/lib/account-export/export";
import { applyStrip, ownerFilter } from "@/lib/account-export/models";
import { prisma } from "@/lib/prisma";

import { buildPrismaMock } from "./prisma-mock";

jest.mock("@/lib/prisma", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { buildPrismaMock } = require("./prisma-mock");
  const prisma = buildPrismaMock();
  return { prisma };
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

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

describe("account export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-seed delegates on the shared tx.
    const seed = {
      ConnectedAccount: [
        {
          id: "ca-1",
          userId: "user-1",
          provider: "GOOGLE",
          email: "a@example.com",
          accessToken: "SECRET_ACCESS_TOKEN_XYZ",
          refreshToken: "SECRET_REFRESH_TOKEN_XYZ",
          expiresAt: new Date("2026-12-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      TaskProvider: [
        {
          id: "tp-1",
          userId: "user-1",
          type: "google",
          name: "Google Tasks",
          enabled: true,
          syncEnabled: true,
          syncInterval: "hourly",
          accessToken: "PROVIDER_ACCESS_SECRET",
          refreshToken: "PROVIDER_REFRESH_SECRET",
          expiresAt: new Date("2026-12-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      Project: [
        {
          id: "p-1",
          userId: "user-1",
          name: "Inbox",
          status: "active",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      CalendarEvent: [
        {
          id: "ev-local",
          feedId: "feed-local",
          title: "Local",
          start: new Date("2026-11-01T10:00:00.000Z"),
          end: new Date("2026-11-01T11:00:00.000Z"),
          isRecurring: false,
          allDay: false,
          isMaster: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          __ownerUserId: "user-1",
          __feedType: "LOCAL",
        },
        {
          id: "ev-google",
          feedId: "feed-google",
          title: "Synced",
          start: new Date("2026-11-01T10:00:00.000Z"),
          end: new Date("2026-11-01T11:00:00.000Z"),
          isRecurring: false,
          allDay: false,
          isMaster: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          __ownerUserId: "user-1",
          __feedType: "GOOGLE",
        },
      ],
    };

    const fresh = buildPrismaMock(seed);
    Object.assign(db.__tx, fresh.__tx);
    db.$transaction.mockImplementation(((fn: (t: typeof db.__tx) => unknown) =>
      fn(db.__tx)) as typeof db.$transaction);
  });

  it("applies strips to credential and path fields", () => {
    const stripped = applyStrip("ConnectedAccount", {
      accessToken: "SECRET",
      refreshToken: "REFRESH",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(stripped.accessToken).toBe("");
    expect(stripped.refreshToken).toBeNull();
    expect(stripped.expiresAt).toEqual(new Date("1970-01-01T00:00:00.000Z"));

    const material = applyStrip("CourseMaterial", {
      localPath: "/tmp/file",
      downloadError: "boom",
      title: "Slides",
    });
    expect(material.localPath).toBeNull();
    expect(material.downloadError).toBeNull();
    expect(material.title).toBe("Slides");
  });

  it("issues owner-filtered queries including CalendarEvent LOCAL", async () => {
    const { stream } = exportAccountStream("user-1");
    await readStream(stream);

    expect(db.__tx.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: ownerFilter("Project", "user-1") })
    );
    expect(db.__tx.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: ownerFilter("CalendarEvent", "user-1"),
      })
    );
    expect(ownerFilter("CalendarEvent", "user-1")).toEqual({
      feed: { userId: "user-1", type: "LOCAL" },
    });
  });

  it("gzip round-trips and header counts match body lines", async () => {
    const { stream, filename } = exportAccountStream("user-1");
    expect(filename).toMatch(/^sigwald-\d{4}-\d{2}-\d{2}\.sigwald$/);

    const gzipped = await readStream(stream);
    const text = gunzipSync(gzipped).toString("utf8");
    const lines = text.trim().split("\n");
    const header = JSON.parse(lines[0]) as {
      format: string;
      formatVersion: number;
      counts: Record<string, number>;
    };
    expect(header.format).toBe("sigwald-export");
    expect(header.formatVersion).toBe(1);

    const bodyCounts: Record<string, number> = {};
    for (const line of lines.slice(1)) {
      const entry = JSON.parse(line) as { m: string };
      bodyCounts[entry.m] = (bodyCounts[entry.m] ?? 0) + 1;
    }
    for (const [model, n] of Object.entries(header.counts)) {
      expect(bodyCounts[model] ?? 0).toBe(n);
    }
  });

  it("never writes credential strings into the export", async () => {
    const { stream } = exportAccountStream("user-1");
    const text = gunzipSync(await readStream(stream)).toString("utf8");
    expect(text).not.toContain("SECRET_ACCESS_TOKEN_XYZ");
    expect(text).not.toContain("SECRET_REFRESH_TOKEN_XYZ");
    expect(text).not.toContain("PROVIDER_ACCESS_SECRET");
    expect(text).not.toContain("PROVIDER_REFRESH_SECRET");

    const row = serializeExportRow("ConnectedAccount", {
      id: "ca-1",
      accessToken: "SECRET_ACCESS_TOKEN_XYZ",
      refreshToken: "SECRET_REFRESH_TOKEN_XYZ",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      email: "a@example.com",
      provider: "GOOGLE",
    });
    expect(row.accessToken).toBe("");
    expect(JSON.stringify(row)).not.toContain("SECRET_ACCESS_TOKEN_XYZ");
  });

  it("uses a RepeatableRead transaction", async () => {
    const { stream } = exportAccountStream("user-1");
    await readStream(stream);
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: "RepeatableRead",
      })
    );
  });
});
