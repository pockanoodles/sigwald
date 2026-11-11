import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyCalcom } from "@/lib/connectors/calcom/client";
import { CALCOM } from "@/lib/connectors/calcom/service";

import calcom from "@/modules/calcom/manifest";
import { pullCalcom } from "@/modules/calcom/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const API = "https://api.cal.com/v2";
const now = new Date("2026-11-11T15:00:00.000Z");

const booking = (uid: string, over: Record<string, unknown> = {}) => ({
  id: 1,
  uid,
  title: "30 min between Kai and Dana",
  status: "accepted",
  start: "2026-11-12T16:00:00.000Z",
  end: "2026-11-12T16:30:00.000Z",
  duration: 30,
  location: "https://meet.example.com/abc",
  meetingUrl: "https://meet.example.com/abc",
  updatedAt: "2026-11-10T10:00:00.000Z",
  eventType: { id: 5, slug: "30min" },
  attendees: [
    { name: "Dana Reyes", email: "dana@example.com", timeZone: "UTC" },
  ],
  ...over,
});

const page = (data: unknown[], hasMore = false) => ({
  status: "success",
  data,
  pagination: { nextCursor: hasMore ? "next" : null, hasMore },
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "cal_live_abcdefghijklmnop" },
  config: { userId: "3" },
  settings: resolveSettings(calcom.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyCalcom", () => {
  it("names the account", async () => {
    const { http, calls } = fakeServiceHttp(CALCOM, [
      {
        url: `${API}/me`,
        json: {
          status: "success",
          data: { id: 3, name: "Kai Soeno", email: "k@x.io" },
        },
      },
    ]);
    await expect(
      verifyCalcom({ http, secret: { token: "cal_x" }, config: {} })
    ).resolves.toEqual({ label: "Kai Soeno", config: { userId: "3" } });
    expect(calls[0].headers.Authorization).toBe("Bearer cal_x");
  });
});

describe("pullCalcom", () => {
  it("makes a busy event per upcoming booking, with attendee names only", async () => {
    const { http, calls } = fakeServiceHttp(CALCOM, [
      {
        url: `${API}/bookings`,
        json: page([
          booking("b1"),
          booking("b2", {
            location: "Office, 5th floor",
            meetingUrl: null,
            attendees: [],
          }),
        ]),
      },
    ]);
    const result = await pullCalcom(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls[0].headers["cal-api-version"]).toBe("2026-05-01");
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("status")).toBe("upcoming");
    expect(query.get("afterStart")).toBe("2026-11-10T15:00:00.000Z");
    expect(query.get("beforeEnd")).toBe("2026-12-11T15:00:00.000Z");
    expect(result.items[0]).toMatchObject({
      kind: "event",
      externalId: "b1",
      title: "30 min between Kai and Dana",
      busy: true,
      state: "open",
      start: new Date("2026-11-12T16:00:00.000Z"),
      url: "https://meet.example.com/abc",
      location: null,
      description: "With Dana Reyes",
    });
    expect(result.items[1]).toMatchObject({
      location: "Office, 5th floor",
      url: null,
      description: null,
    });
    expect(JSON.stringify(result)).not.toContain("@");
  });

  it("brings a held booking back done when it is cancelled", async () => {
    const { http } = fakeServiceHttp(CALCOM, [
      { url: `${API}/bookings?status=upcoming`, json: page([]) },
      {
        url: `${API}/bookings?status=cancelled`,
        json: page([
          booking("b9", { status: "cancelled" }),
          booking("b7", { status: "cancelled" }),
        ]),
      },
    ]);
    const result = await pullCalcom(
      ctx(http, {
        open: [{ externalId: "b9", kind: "event", title: "Held" }],
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ externalId: "b9", state: "done" });
    expect(result.complete).toBe(true);
  });

  it("follows the cursor once, then says the answer is partial", async () => {
    const { http, calls } = fakeServiceHttp(CALCOM, [
      { url: `${API}/bookings`, json: page([booking("b1")], true) },
    ]);
    const result = await pullCalcom(ctx(http));
    expect(result.complete).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("cursor=next");
  });

  it("only reads", async () => {
    const { http, calls } = fakeServiceHttp(CALCOM, [
      { url: `${API}/bookings`, json: page([]) },
    ]);
    await pullCalcom(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
