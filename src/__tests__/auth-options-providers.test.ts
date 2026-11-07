import { getAuthOptions } from "@/lib/auth/auth-options";

/**
 * Email + password is the only sign-in. With no adapter, a Google or Microsoft
 * provider here would mint a session for any account on that provider, so the
 * calendar connections live in api/calendar/{google,outlook} instead.
 */
describe("sign-in providers", () => {
  const saved = { ...process.env };

  // getAuthOptions refuses to build options without a signing key.
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  afterAll(() => {
    process.env = saved;
  });

  it("offers credentials only", async () => {
    const options = await getAuthOptions();
    expect(options.providers.map((p) => p.id)).toEqual(["credentials"]);
  });

  it("keeps provider tokens out of the session", async () => {
    const options = await getAuthOptions();
    const session = await options.callbacks!.session!({
      session: { user: { email: "a@example.com" }, expires: "2099-01-01" },
      token: { role: "admin", accessToken: "leak" },
    } as never);
    expect(session).not.toHaveProperty("accessToken");
    expect((session as { user: { role?: string } }).user.role).toBe("admin");
  });
});
