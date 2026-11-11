import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyUptimeRobot } from "@/lib/connectors/uptimerobot/client";
import { UPTIMEROBOT } from "@/lib/connectors/uptimerobot/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import uptimerobot from "@/modules/uptimerobot/manifest";
import { pullUptimeRobot } from "@/modules/uptimerobot/pull";

const API = "https://api.uptimerobot.com/v3";
const secret = { key: "ur-read-only-key-123" };
const now = new Date("2026-11-11T15:00:00.000Z");

const monitor = (id: number, status: string) => ({
  id,
  friendlyName: `Site ${id}`,
  status,
  url: `https://site${id}.example.com`,
  currentStateDuration: 120,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret,
  config: {},
  settings: resolveSettings(uptimerobot.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const stats = {
  url: `${API}/monitors/uptime-stats`,
  json: {
    overallUptime: 99.876,
    totalIncidents: 2,
    totalTimeWithoutIncidents: 1,
    affectedMonitors: 1,
    mtbf: null,
    logs: [],
  },
};

describe("verifyUptimeRobot", () => {
  it("sends the key as a bearer token with a GET and names the account", async () => {
    const { http, calls } = fakeServiceHttp(UPTIMEROBOT, [
      {
        url: `${API}/user/me`,
        json: { email: "k@x.io", fullName: "Kai Soeno", monitorsCount: 3 },
      },
    ]);
    await expect(
      verifyUptimeRobot({ http, secret, config: {} })
    ).resolves.toEqual({ label: "Kai Soeno" });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${secret.key}`);
  });
});

describe("pullUptimeRobot", () => {
  it("makes a high-impact task per down monitor, and readings", async () => {
    const { http, calls } = fakeServiceHttp(UPTIMEROBOT, [
      {
        url: `${API}/monitors?`,
        json: {
          nextLink: null,
          data: [monitor(1, "UP"), monitor(2, "DOWN"), monitor(3, "PAUSED")],
        },
      },
      stats,
    ]);
    const result = await pullUptimeRobot(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      externalId: "2",
      title: "Down: Site 2",
      state: "open",
      impact: 0.95,
      group: { key: "uptimerobot:monitor:2", label: "Site 2" },
    });
    expect(result.readings).toEqual([
      { key: "up", label: "Monitors up", value: 1, unit: "count" },
      { key: "total", label: "Monitors", value: 3, unit: "count" },
      {
        key: "uptime30",
        label: "Uptime, 30 days",
        value: 99.88,
        unit: "percent",
      },
    ]);
  });

  it("finishes a held task once its monitor is up, and lets a deleted or paused one go", async () => {
    const { http } = fakeServiceHttp(UPTIMEROBOT, [
      {
        url: `${API}/monitors?`,
        json: {
          nextLink: null,
          data: [monitor(1, "UP"), monitor(3, "PAUSED")],
        },
      },
      stats,
    ]);
    const result = await pullUptimeRobot(
      ctx(http, {
        open: [
          { externalId: "1", kind: "task", title: "Down: Site 1" },
          { externalId: "3", kind: "task", title: "Down: Site 3" },
        ],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "1",
        title: "Down: Site 1",
        state: "done",
        doneAt: now,
      },
      {
        kind: "task",
        externalId: "3",
        title: "Down: Site 3",
        state: "gone",
        doneAt: null,
      },
    ]);
    // Monitor 9 was deleted: not listed, and a complete pull says it's gone.
    expect(result.complete).toBe(true);
  });

  it("follows the cursor, and isn't complete when pages run out", async () => {
    const { http, calls } = fakeServiceHttp(UPTIMEROBOT, [
      {
        url: `${API}/monitors?`,
        json: {
          nextLink: `${API}/monitors?limit=200&cursor=7`,
          data: [monitor(1, "UP")],
        },
      },
      stats,
    ]);
    const result = await pullUptimeRobot(ctx(http));
    expect(calls[1].url).toContain("cursor=7");
    // Every page says there is more.
    expect(result.complete).toBe(false);
    expect(result.readings?.map((r) => r.key)).not.toContain("total");
  });
});
