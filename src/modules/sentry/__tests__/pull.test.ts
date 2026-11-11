import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { nextCursor, verifySentry } from "@/lib/connectors/sentry/client";
import { SENTRY } from "@/lib/connectors/sentry/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import sentry from "@/modules/sentry/manifest";
import { impactOfLevel, pullSentry } from "@/modules/sentry/pull";

const config = { org: "acme", region: "" };
const API = "https://sentry.io/api/0/organizations/acme";
const now = new Date("2026-11-11T15:00:00.000Z");

const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  shortId: `WEB-${id}`,
  title: `TypeError ${id}`,
  level: "error",
  status: "unresolved",
  permalink: `https://sentry.io/organizations/acme/issues/${id}/`,
  count: "1204",
  userCount: 31,
  firstSeen: "2026-11-01T08:00:00Z",
  lastSeen: "2026-11-11T14:00:00Z",
  project: { slug: "Web-App", name: "Web App" },
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "sntryu_abc" },
  config,
  settings: resolveSettings(sentry.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifySentry", () => {
  it("reads the organization with a Bearer token", async () => {
    const { http, calls } = fakeServiceHttp(SENTRY, [
      { url: `${API}/`, json: { slug: "acme", name: "Acme Inc" } },
    ]);
    await expect(
      verifySentry({ http, secret: { token: "t" }, config })
    ).resolves.toEqual({ label: "Acme Inc" });
    expect(calls[0].headers.Authorization).toBe("Bearer t");
  });

  it("reads a region's host when one is set", async () => {
    const { http, calls } = fakeServiceHttp(SENTRY, [
      {
        url: "https://de.sentry.io/api/0/organizations/acme/",
        json: { slug: "acme" },
      },
    ]);
    await verifySentry({
      http,
      secret: { token: "t" },
      config: { org: "acme", region: "de.sentry.io" },
    });
    expect(calls[0].url).toBe("https://de.sentry.io/api/0/organizations/acme/");
  });
});

describe("pullSentry", () => {
  it("makes Fix tasks for unresolved issues assigned to you", async () => {
    const { http, calls } = fakeServiceHttp(SENTRY, [
      {
        url: `${API}/issues/`,
        json: [issue("11"), issue("12", { level: "fatal" })],
      },
    ]);
    const result = await pullSentry(ctx(http));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(new URL(calls[0].url).searchParams.get("query")).toBe(
      "is:unresolved assigned:me"
    );
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      externalId: "11",
      title: "Fix: TypeError 11",
      impact: 0.7,
      url: "https://sentry.io/organizations/acme/issues/11/",
      group: { key: "sentry:project:web-app", label: "Web App" },
      facts: expect.arrayContaining([
        { label: "Events", value: "1204" },
        { label: "Users", value: "31" },
        { label: "Project", value: "Web App" },
        { label: "First seen", value: "2026-11-01T08:00:00Z" },
      ]),
    });
    expect(result.items[1]).toMatchObject({ impact: 0.9 });
  });

  it("follows the Link header and is partial past the cap", async () => {
    const link =
      '<https://sentry.io/x>; rel="previous"; results="false"; cursor="0:0:1", <https://sentry.io/x>; rel="next"; results="true"; cursor="0:100:0"';
    const { http, calls } = fakeServiceHttp(SENTRY, [
      {
        url: `${API}/issues/`,
        json: [issue("11")],
        headers: { "content-type": "application/json", link },
      },
    ]);
    const result = await pullSentry(ctx(http));
    expect(calls).toHaveLength(3);
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe("0:100:0");
    expect(result.complete).toBe(false);
  });

  it("finishes held issues that were resolved, and says the others are gone", async () => {
    const { http, calls } = fakeServiceHttp(SENTRY, [
      { url: `${API}/issues/?`, json: [] },
      { url: `${API}/issues/21/`, json: issue("21", { status: "resolved" }) },
      { url: `${API}/issues/22/`, json: issue("22", { status: "unresolved" }) },
      { url: `${API}/issues/23/`, status: 404, json: { detail: "gone" } },
    ]);
    const result = await pullSentry(
      ctx(http, {
        open: [
          { externalId: "21", kind: "task", title: "Fix: A" },
          { externalId: "22", kind: "task", title: "Fix: B" },
          { externalId: "23", kind: "task", title: "Fix: C" },
        ],
      })
    );
    // 22 is unresolved but off a complete "assigned to me" search, so it's
    // someone else's now; 23 was deleted. Both are gone, said one by one.
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "21",
        title: "Fix: A",
        state: "done",
        doneAt: now,
      }),
      { kind: "task", externalId: "22", title: "Fix: B", state: "gone" },
      { kind: "task", externalId: "23", title: "Fix: C", state: "gone" },
    ]);
    expect(result.complete).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("is partial when a held issue can't be read", async () => {
    const { http } = fakeServiceHttp(SENTRY, [
      { url: `${API}/issues/?`, json: [] },
      { url: `${API}/issues/21/`, status: 500, json: {} },
    ]);
    const result = await pullSentry(
      ctx(http, {
        open: [{ externalId: "21", kind: "task", title: "Fix: A" }],
      })
    );
    expect(result.items).toEqual([]);
    expect(result.complete).toBe(false);
  });
});

describe("helpers", () => {
  it("weights levels", () => {
    expect(impactOfLevel("fatal")).toBe(0.9);
    expect(impactOfLevel("warning")).toBe(0.4);
    expect(impactOfLevel("debug")).toBe(0.15);
    expect(impactOfLevel(undefined)).toBeNull();
  });
  it("reads no cursor off the last page", () => {
    expect(nextCursor('<u>; rel="next"; results="false"; cursor="0:1:0"')).toBe(
      null
    );
    expect(nextCursor(null)).toBeNull();
  });
});
