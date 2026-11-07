import { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/auth/api-auth", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
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
  db.connectedAccount.findUnique.mockResolvedValue(null);
  db.connectedAccount.update.mockResolvedValue({ id: "acct-1" });
  db.connectedAccount.create.mockResolvedValue({ id: "acct-new" });
});

const LOGIN = {
  serverUrl: "https://dav.example",
  username: "me@example.com",
  password: "new-app-password",
};

describe("POST /api/calendar/caldav/auth", () => {
  it("creates the account on first connect", async () => {
    const { POST } = await import("@/app/api/calendar/caldav/auth/route");
    const res = await POST(post(LOGIN));
    expect(res?.status).toBe(200);
    expect(db.connectedAccount.findUnique.mock.calls[0][0].where).toEqual({
      userId_provider_email: {
        userId: "u1",
        provider: "CALDAV",
        email: "me@example.com",
      },
    });
    expect(db.connectedAccount.create.mock.calls[0][0].data).toMatchObject({
      provider: "CALDAV",
      email: "me@example.com",
      userId: "u1",
      accessToken: "new-app-password",
      caldavUrl: "https://dav.example",
    });
  });

  it("updates the existing account when the same login connects to the same server again", async () => {
    db.connectedAccount.findUnique.mockResolvedValue({
      id: "acct-1",
      caldavUrl: "https://dav.example",
    });
    const { POST } = await import("@/app/api/calendar/caldav/auth/route");
    const res = await POST(post(LOGIN));
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      success: true,
      accountId: "acct-1",
    });
    expect(db.connectedAccount.create).not.toHaveBeenCalled();
    expect(db.connectedAccount.update.mock.calls[0][0]).toMatchObject({
      where: { id: "acct-1" },
      data: { accessToken: "new-app-password", caldavUsername: "me@example.com" },
    });
  });

  it("refuses the same username on a different server instead of repointing the account", async () => {
    db.connectedAccount.findUnique.mockResolvedValue({
      id: "acct-1",
      caldavUrl: "https://other-server.example",
    });
    const { POST } = await import("@/app/api/calendar/caldav/auth/route");
    const res = await POST(post(LOGIN));
    expect(res?.status).toBe(409);
    expect(db.connectedAccount.update).not.toHaveBeenCalled();
    expect(db.connectedAccount.create).not.toHaveBeenCalled();
  });
});
