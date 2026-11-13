import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyCalendly } from "@/lib/connectors/calendly/client";
import { CALENDLY } from "@/lib/connectors/calendly/service";

import calendly from "@/modules/calendly/manifest";
import { pullCalendly } from "@/modules/calendly/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const API = "https://api.calendly.com";
const USER = "https://api.calendly.com/users/AAA";
const now = new Date("2026-11-11T15:00:00.000Z");

const event = (uuid: string, over: Record<string, unknown> = {}) => ({
  uri: `${API}/scheduled_events/${uuid}`,
  name: "30 Minute Meeting",
  status: "active",
  start_time: "2026-11-12T16:00:00.000000Z",
  end_time: "2026-11-12T16:30:00.000000Z",
  updated_at: "2026-11-10T10:00:00.000000Z",
  location: { type: "zoom", join_url: "https://zoom.us/j/123" },
  event_memberships: [{ user: USER, user_email: "me@example.com" }],
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "eyJabcdefghijklmnopqrstuvwxyz" },
  config: { userUri: USER },
  settings: resolveSettings(calendly.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const page = (collection: unknown[], next: string | null = null) => ({
  collection,
  pagination: { count: collection.length, next_page_token: next },
});

describe("verifyCalendly", () => {
  it("keeps the user's uri", async () => {
    const { http, calls } = fakeServiceHttp(CALENDLY, [
      {
        url: `${API}/users/me`,
        json: { resource: { uri: USER, name: "Kai Soeno", email: "k@x.io" } },
      },
    ]);
    await expect(
      verifyCalendly({ http, secret: { token: "t" }, config: {} })
    ).resolves.toEqual({ label: "Kai Soeno", config: { userUri: USER } });
    expect(calls[0].headers.Authorization).toBe("Bearer t");
  });
});

describe("pullCalendly", () => {
  it("makes a busy event per active booking, titled by event type, with names only", async () => {
    const { http, calls } = fakeServiceHttp(CALENDLY, [
      {
        url: `${API}/scheduled_events?`,
        json: page([event("E1"), event("E2", { name: "Intro call" })]),
      },
      {
        url: `${API}/scheduled_events/E1/invitees`,
        json: {
          collection: [{ name: "Dana Reyes", email: "dana@example.com" }],
        },
      },
      {
        url: `${API}/scheduled_events/E2/invitees`,
        json: { collection: [] },
      },
    ]);
    const result = await pullCalendly(ctx(http));
    expect(result.complete).toBe(true);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("user")).toBe(USER);
    expect(query.get("status")).toBe("active");
    expect(query.get("min_start_time")).toBe("2026-11-10T15:00:00.000Z");
    expect(query.get("max_start_time")).toBe("2026-12-11T15:00:00.000Z");
    expect(result.items[0]).toMatchObject({
      kind: "event",
      externalId: `${API}/scheduled_events/E1`,
      title: "30 Minute Meeting",
      busy: true,
      state: "open",
      start: new Date("2026-11-12T16:00:00.000Z"),
      url: "https://zoom.us/j/123",
      description: "With Dana Reyes",
    });
    expect(result.items[1]).toMatchObject({
      title: "Intro call",
      description: null,
    });
    expect(JSON.stringify(result)).not.toContain("@");
  });

  it("brings a held booking back done when it is cancelled", async () => {
    const e9 = event("E9", { status: "canceled" });
    const { http } = fakeServiceHttp(CALENDLY, [
      {
        url: `${API}/scheduled_events?user=${encodeURIComponent(USER)}&status=active`,
        json: page([]),
      },
      {
        url: `${API}/scheduled_events?user=${encodeURIComponent(USER)}&status=canceled`,
        json: page([e9, event("E7")]),
      },
    ]);
    const result = await pullCalendly(
      ctx(http, {
        open: [
          { externalId: e9.uri, kind: "event", title: "30 Minute Meeting" },
        ],
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      externalId: e9.uri,
      state: "done",
    });
    expect(result.complete).toBe(true);
  });

  it("says the answer is partial past its page cap", async () => {
    const { http } = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([], "next") },
    ]);
    expect((await pullCalendly(ctx(http))).complete).toBe(false);
  });

  it("skips the invitee reads when told to, and survives one failing", async () => {
    const off = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([event("E1")]) },
    ]);
    await pullCalendly(
      ctx(off.http, {
        settings: resolveSettings(calendly.connect!.settings, { names: false }),
      })
    );
    expect(off.calls).toHaveLength(1);

    const failing = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([event("E1")]) },
      { url: `${API}/scheduled_events/E1/invitees`, status: 403, json: {} },
    ]);
    const result = await pullCalendly(ctx(failing.http));
    expect(result.items).toHaveLength(1);
  });

  it("reads a meeting's names again only when the booking changes", async () => {
    const uri = `${API}/scheduled_events/E1`;
    const group = (active: number) =>
      event("E1", { invitees_counter: { total: active, active, limit: 5 } });
    const first = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([group(1)]) },
      {
        url: `${API}/scheduled_events/E1/invitees`,
        json: { collection: [{ name: "Dana Reyes" }] },
      },
    ]);
    const kept = (await pullCalendly(ctx(first.http))).cursor;

    const same = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([group(1)]) },
    ]);
    const unchanged = await pullCalendly(ctx(same.http, { cursor: kept }));
    expect(same.calls).toHaveLength(1);
    expect(unchanged.items[0]).toMatchObject({
      description: "With Dana Reyes",
    });

    const joined = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([group(2)]) },
      {
        url: `${API}/scheduled_events/E1/invitees`,
        json: { collection: [{ name: "Dana Reyes" }, { name: "Sam Ito" }] },
      },
    ]);
    const after = await pullCalendly(ctx(joined.http, { cursor: kept }));
    expect(after.items[0]).toMatchObject({
      externalId: uri,
      description: "With Dana Reyes, Sam Ito",
    });

    // A failed re-read keeps the names it had, and tries again next time.
    const failing = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([group(2)]) },
      { url: `${API}/scheduled_events/E1/invitees`, status: 403, json: {} },
    ]);
    const held = await pullCalendly(ctx(failing.http, { cursor: kept }));
    expect(held.items[0]).toMatchObject({ description: "With Dana Reyes" });
    expect(held.cursor).toEqual(kept);
  });

  it("only reads", async () => {
    const { http, calls } = fakeServiceHttp(CALENDLY, [
      { url: `${API}/scheduled_events?`, json: page([]) },
    ]);
    await pullCalendly(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
