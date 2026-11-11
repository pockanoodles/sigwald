import type { ServiceManifest } from "@/lib/connectors/types";

import { parseConnectFields } from "@/modules/connect/fields";
import { askedWait, isPullDue, pullWait } from "@/modules/connect/run";
import type { ConnectSpec } from "@/modules/connect/spec";

const jira: ServiceManifest = {
  id: "jira",
  name: "Jira",
  homepage: "https://atlassian.com",
  fields: [
    { key: "site", label: "Site", kind: "url" },
    { key: "email", label: "Email", kind: "text" },
    {
      key: "token",
      label: "Token",
      kind: "secret",
      pattern: { source: "[A-Za-z0-9_-]{8,}", message: "a token" },
    },
    { key: "note", label: "Note", kind: "text", optional: true },
  ],
  host: { kind: "site", field: "site", hosts: ["*.atlassian.net"] },
  egress: { to: "Jira", sends: "x", why: "y." },
};

describe("parseConnectFields", () => {
  it("splits secret from config and keeps a typed site safely", () => {
    expect(
      parseConnectFields(jira, {
        fields: {
          site: "acme.atlassian.net/",
          email: " me@acme.io ",
          token: "abcdefgh123",
        },
      })
    ).toEqual({
      secret: { token: "abcdefgh123" },
      config: { site: "https://acme.atlassian.net", email: "me@acme.io" },
    });
  });

  it("refuses what the service wouldn't take, before anything is sent", () => {
    const problem = (fields: Record<string, string>) => {
      const r = parseConnectFields(jira, { fields });
      return "problem" in r ? r.problem : null;
    };
    expect(problem({ site: "acme.atlassian.net", email: "e" })).toBe(
      "Token is needed"
    );
    expect(
      problem({ site: "acme.atlassian.net", email: "e", token: "short" })
    ).toBe("a token");
    expect(
      problem({ site: "evil.example.com", email: "e", token: "abcdefgh123" })
    ).toMatch(/must be one of/);
    expect(
      problem({
        site: "http://acme.atlassian.net",
        email: "e",
        token: "abcdefgh123",
      })
    ).toMatch(/https/);
  });
});

describe("pull timing", () => {
  const spec = { everyMinutes: 15 } as ConnectSpec;
  const now = new Date("2026-11-11T15:00:00.000Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("pulls when it never has, then once its interval has passed", () => {
    expect(isPullDue(spec, null, now)).toBe(true);
    expect(isPullDue(spec, { lastPullAt: ago(14), failures: 0 }, now)).toBe(
      false
    );
    expect(isPullDue(spec, { lastPullAt: ago(15), failures: 0 }, now)).toBe(
      true
    );
  });

  it("waits twice as long after each failure, up to 12 hours", () => {
    expect(pullWait(spec, 1)).toBe(30 * 60_000);
    expect(pullWait(spec, 3)).toBe(120 * 60_000);
    expect(pullWait(spec, 20)).toBe(12 * 60 * 60_000);
    expect(isPullDue(spec, { lastPullAt: ago(100), failures: 3 }, now)).toBe(
      false
    );
  });

  it("waits as long as the service asked, even past its own backoff", () => {
    const retryAt = new Date(now.getTime() + 50 * 60_000);
    const limited = { lastPullAt: ago(100), failures: 1, retryAt };
    expect(isPullDue(spec, limited, now)).toBe(false);
    expect(askedWait(limited, now)).toBe(50);
    const later = new Date(retryAt.getTime() + 1);
    expect(isPullDue(spec, limited, later)).toBe(true);
    expect(askedWait(limited, later)).toBe(0);
  });

  it("never pulls a module that's sent things instead", () => {
    expect(isPullDue({ everyMinutes: 0 } as ConnectSpec, null, now)).toBe(
      false
    );
  });
});
