import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyPatreon } from "@/lib/connectors/patreon/client";
import { PATREON } from "@/lib/connectors/patreon/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import patreon from "@/modules/patreon/manifest";
import { pullPatreon } from "@/modules/patreon/pull";

const API = "https://www.patreon.com/api/oauth2/v2";

const ctx = (http: PullContext["http"]): PullContext => ({
  http,
  secret: { token: "creator-token-abcdefgh" },
  config: {},
  settings: resolveSettings(patreon.connect!.settings, {}),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

describe("verifyPatreon", () => {
  it("names the creator by full name, asking for just that field", async () => {
    const { http, calls } = fakeServiceHttp(PATREON, [
      {
        url: `${API}/identity`,
        json: {
          data: { id: "1", type: "user", attributes: { full_name: "Kaito S" } },
        },
      },
    ]);
    await expect(
      verifyPatreon({ http, secret: { token: "t" }, config: {} })
    ).resolves.toEqual({ label: "Kaito S" });
    expect(new URL(calls[0].url).searchParams.get("fields[user]")).toBe(
      "full_name"
    );
    expect(calls[0].headers.Authorization).toBe("Bearer t");
  });
});

describe("pullPatreon", () => {
  it("reads the patron count with a sparse fieldset", async () => {
    const { http, calls } = fakeServiceHttp(PATREON, [
      {
        url: `${API}/campaigns`,
        json: {
          data: [
            { id: "9", type: "campaign", attributes: { patron_count: 128 } },
          ],
          meta: { pagination: { total: 1 } },
        },
      },
    ]);
    const out = await pullPatreon(ctx(http));
    expect(out.readings).toEqual([
      { key: "patrons", label: "Patrons", value: 128, unit: "count" },
    ]);
    expect(out.complete).toBe(true);
    expect(new URL(calls[0].url).searchParams.get("fields[campaign]")).toBe(
      "patron_count"
    );
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("gives no reading when the count is private", async () => {
    const { http } = fakeServiceHttp(PATREON, [
      {
        url: `${API}/campaigns`,
        json: {
          data: [
            { id: "9", type: "campaign", attributes: { patron_count: null } },
          ],
        },
      },
    ]);
    const out = await pullPatreon(ctx(http));
    expect(out.readings).toEqual([]);
  });
});
