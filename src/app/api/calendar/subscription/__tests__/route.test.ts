import { authenticateRequest } from "@/lib/auth/api-auth";
import { hashToken } from "@/lib/ical-out";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/auth/api-auth", () => ({ authenticateRequest: jest.fn() }));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    calendarSubscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
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

const mockAuth = authenticateRequest as jest.MockedFunction<
  typeof authenticateRequest
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const USER_ID = "user-1";

function assertResponse<T>(res: T | undefined): T {
  if (res == null) throw new Error("expected a route response, got undefined");
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER_ID } as never);
  process.env.NEXTAUTH_URL = "https://sigwald.example";
});

describe("POST /api/calendar/subscription", () => {
  it("returns a url whose token hashes to what was stored, without storing the raw token", async () => {
    const { POST } = await import(
      "@/app/api/calendar/subscription/route"
    );

    db.calendarSubscription.upsert.mockImplementation(
      async ({ create }: { create: { tokenHash: string; userId: string } }) => ({
        id: "sub-1",
        ...create,
        createdAt: new Date(),
        lastUsedAt: null,
      })
    );

    const res = assertResponse(await POST({} as never));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };

    expect(body.url).toMatch(
      /^https:\/\/sigwald\.example\/api\/calendar\/plan\/[^/]+\.ics$/
    );

    const token = body.url
      .replace("https://sigwald.example/api/calendar/plan/", "")
      .replace(/\.ics$/, "");

    const upsertArg = db.calendarSubscription.upsert.mock.calls[0][0];
    expect(upsertArg.create.tokenHash).toBe(hashToken(token));
    expect(upsertArg.update.tokenHash).toBe(hashToken(token));

    const stored = JSON.stringify(upsertArg);
    expect(stored).not.toContain(token);
    expect(upsertArg.create).not.toHaveProperty("token");
    expect(upsertArg.update).not.toHaveProperty("token");
  });
});

describe("GET /api/calendar/subscription", () => {
  it("reports exists false when there is no row", async () => {
    const { GET } = await import("@/app/api/calendar/subscription/route");
    db.calendarSubscription.findUnique.mockResolvedValue(null);

    const res = assertResponse(await GET({} as never));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
  });
});

describe("DELETE /api/calendar/subscription", () => {
  it("returns 204", async () => {
    const { DELETE } = await import(
      "@/app/api/calendar/subscription/route"
    );
    db.calendarSubscription.deleteMany.mockResolvedValue({ count: 1 });

    const res = assertResponse(await DELETE({} as never));
    expect(res.status).toBe(204);
    expect(db.calendarSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });
});
