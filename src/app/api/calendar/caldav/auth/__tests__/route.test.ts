import { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/auth/api-auth", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { connectedAccount: { upsert: jest.fn(), create: jest.fn() } },
}));
jest.mock("@/lib/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock("@/app/api/calendar/caldav/utils", () => ({
  classifyCalDAVError: jest.fn(),
  createCalDAVClient: jest.fn(() => ({})),
  fetchCalDAVCalendars: jest.fn(async () => []),
  formatAbsoluteUrl: (base: string, path?: string) => `${base}${path ?? ""}`,
  handleFastmailPath: jest.fn(() => undefined),
  loginToCalDAVServer: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function post(body: unknown) {
  return new NextRequest("http://localhost/api/calendar/caldav/auth", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ userId: "u1" });
  db.connectedAccount.upsert.mockResolvedValue({ id: "acct-1" });
});

describe("POST /api/calendar/caldav/auth", () => {
  it("updates the existing account when the same login connects again", async () => {
    const { POST } = await import("@/app/api/calendar/caldav/auth/route");
    const res = await POST(
      post({
        serverUrl: "https://dav.example",
        username: "me@example.com",
        password: "new-app-password",
      })
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      success: true,
      accountId: "acct-1",
    });
    expect(db.connectedAccount.create).not.toHaveBeenCalled();
    const args = db.connectedAccount.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      userId_provider_email: {
        userId: "u1",
        provider: "CALDAV",
        email: "me@example.com",
      },
    });
    expect(args.update).toMatchObject({
      accessToken: "new-app-password",
      caldavUrl: "https://dav.example",
      caldavUsername: "me@example.com",
    });
    expect(args.create).toMatchObject({
      provider: "CALDAV",
      email: "me@example.com",
      userId: "u1",
      accessToken: "new-app-password",
    });
  });
});
