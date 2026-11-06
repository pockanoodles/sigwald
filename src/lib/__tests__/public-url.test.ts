import { NextRequest } from "next/server";

import { publicUrl } from "@/lib/public-url";
import { middleware } from "@/middleware";

describe("publicUrl", () => {
  const originalUrl = process.env.NEXTAUTH_URL;
  afterEach(() => {
    process.env.NEXTAUTH_URL = originalUrl;
  });

  it("resolves against NEXTAUTH_URL, not the bind address", () => {
    process.env.NEXTAUTH_URL = "https://optiplex.example.ts.net";
    const url = publicUrl("/auth/signin", { url: "https://localhost:3939/" });
    expect(url.href).toBe("https://optiplex.example.ts.net/auth/signin");
  });

  it("falls back to the request when NEXTAUTH_URL is unset", () => {
    delete process.env.NEXTAUTH_URL;
    const url = publicUrl("/today", { url: "http://localhost:3000/x" });
    expect(url.href).toBe("http://localhost:3000/today");
  });
});

describe("middleware behind a proxy on loopback", () => {
  const originalUrl = process.env.NEXTAUTH_URL;
  const originalSecret = process.env.NEXTAUTH_SECRET;
  beforeEach(() => {
    process.env.NEXTAUTH_URL = "https://optiplex.example.ts.net";
    process.env.NEXTAUTH_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.NEXTAUTH_URL = originalUrl;
    process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it("sends a signed-out visitor at / to the public sign-in page", async () => {
    const res = await middleware(new NextRequest("https://localhost:3939/"));
    expect(res.headers.get("location")).toBe(
      "https://optiplex.example.ts.net/auth/signin"
    );
  });

  it("keeps a protected path as a relative callbackUrl", async () => {
    const res = await middleware(
      new NextRequest("https://localhost:3939/today?view=week")
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://optiplex.example.ts.net");
    expect(location.pathname).toBe("/auth/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/today?view=week");
  });
});
