import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyClockify } from "@/lib/connectors/clockify/client";
import { CLOCKIFY } from "@/lib/connectors/clockify/service";

import clockify from "@/modules/clockify/manifest";
import { pullClockify } from "@/modules/clockify/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const now = new Date("2026-11-11T15:00:00.000Z");
const API = "https://api.clockify.me/api/v1";
const config = { userId: "u1", workspaceId: "w1" };

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: { key: "k" },
  config,
  settings: resolveSettings(clockify.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const entry = (
  id: string,
  start: string,
  end: string | null,
  duration: string | null
) => ({ id, timeInterval: { start, end, duration } });

describe("verifyClockify", () => {
  it("keeps the user and the active workspace", async () => {
    const { http, calls } = fakeServiceHttp(CLOCKIFY, [
      {
        url: `${API}/user`,
        json: {
          id: "u1",
          name: "Ada Lovelace",
          activeWorkspace: "w1",
          defaultWorkspace: "w0",
        },
      },
    ]);
    await expect(
      verifyClockify({ http, secret: { key: "k" }, config: {} })
    ).resolves.toEqual({
      label: "Ada Lovelace",
      config: { userId: "u1", workspaceId: "w1" },
    });
    expect(calls[0].headers["X-Api-Key"]).toBe("k");
  });
});

describe("pullClockify", () => {
  it("totals today and this week, counting a running entry up to now", async () => {
    const { http, calls } = fakeServiceHttp(CLOCKIFY, [
      {
        url: `${API}/workspaces/w1/user/u1/time-entries`,
        json: [
          entry("1", "2026-11-09T09:00:00Z", "2026-11-09T10:30:00Z", "PT1H30M"),
          entry("2", "2026-11-11T08:00:00Z", "2026-11-11T09:00:00Z", "PT1H"),
          entry("3", "2026-11-11T14:00:00Z", null, null),
          // Sunday night across midnight: 30 minutes of it is Monday
          entry("4", "2026-11-08T23:30:00Z", "2026-11-09T00:30:00Z", "PT1H"),
        ],
      },
    ]);
    const result = await pullClockify(ctx(http));
    expect(result.readings).toEqual([
      { key: "hours_today", label: "Hours today", value: 2, unit: "hours" },
      { key: "hours_week", label: "Hours this week", value: 4, unit: "hours" },
    ]);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("end")).toBe("2026-11-12T00:00:00Z");
    expect(q.get("page-size")).toBe("500");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("leaves the readings out when the pages run out", async () => {
    const full = Array.from({ length: 500 }, (_, i) =>
      entry(String(i), "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z", "PT1H")
    );
    const { http } = fakeServiceHttp(CLOCKIFY, [
      { url: `${API}/workspaces/w1/user/u1/time-entries`, json: full },
    ]);
    const result = await pullClockify(ctx(http));
    expect(result.readings).toBeUndefined();
  });

  it("asks to reconnect when the workspace is unknown", async () => {
    const { http } = fakeServiceHttp(CLOCKIFY, []);
    await expect(
      pullClockify({ ...ctx(http), config: {} })
    ).rejects.toMatchObject({ kind: "config" });
  });
});
