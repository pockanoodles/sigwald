import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyWaniKani } from "@/lib/connectors/wanikani/client";
import { WANIKANI } from "@/lib/connectors/wanikani/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import wanikani from "@/modules/wanikani/manifest";
import { pullWaniKani, waiting } from "@/modules/wanikani/pull";

const API = "https://api.wanikani.com/v2";
const secret = { token: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
// 02:30 UTC on the 12th is still the 11th in New York.
const now = new Date("2026-11-12T02:30:00.000Z");

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const summaryJson = (reviews: number, lessons: number) => ({
  object: "report",
  data: {
    lessons: [
      {
        available_at: "2026-11-12T02:00:00.000000Z",
        subject_ids: ids(lessons),
      },
    ],
    next_reviews_at: "2026-11-12T03:00:00.000000Z",
    reviews: [
      {
        available_at: "2026-11-12T02:00:00.000000Z",
        subject_ids: ids(reviews),
      },
      { available_at: "2026-11-12T03:00:00.000000Z", subject_ids: ids(9) },
    ],
  },
});

const routes = (reviews: number, lessons: number) => [
  {
    url: `${API}/user`,
    json: { object: "user", data: { username: "kai", level: 12 } },
  },
  { url: `${API}/summary`, json: summaryJson(reviews, lessons) },
];

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret,
  config: {},
  settings: resolveSettings(wanikani.connect!.settings, {}),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyWaniKani", () => {
  it("sends the bearer token and the revision header and names the user", async () => {
    const { http, calls } = fakeServiceHttp(WANIKANI, routes(0, 0));
    await expect(verifyWaniKani({ http, secret, config: {} })).resolves.toEqual(
      { label: "kai", config: { level: "12" } }
    );
    expect(calls[0].headers.Authorization).toBe(`Bearer ${secret.token}`);
    expect(calls[0].headers["Wanikani-Revision"]).toBe("20170710");
  });
});

describe("waiting", () => {
  it("counts only the slots whose time has come", () => {
    const slots = summaryJson(5, 0).data.reviews;
    expect(waiting(slots, now)).toBe(5);
  });
});

describe("pullWaniKani", () => {
  it("makes a task per kind for the person's day, with readings", async () => {
    const { http, calls } = fakeServiceHttp(WANIKANI, routes(42, 1));
    const result = await pullWaniKani(ctx(http));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "reviews:2026-11-11",
      title: "Do 42 WaniKani reviews",
      state: "open",
      due: { date: "2026-11-11" },
    });
    expect(result.items[1]).toMatchObject({
      externalId: "lessons:2026-11-11",
      title: "Do 1 WaniKani lesson",
    });
    expect(result.readings).toEqual([
      { key: "level", label: "Level", value: 12, unit: "count" },
      { key: "reviews", label: "Reviews waiting", value: 42, unit: "count" },
      { key: "lessons", label: "Lessons waiting", value: 1, unit: "count" },
    ]);
  });

  it("finishes a held task once none are waiting, and makes none new", async () => {
    const { http } = fakeServiceHttp(WANIKANI, routes(0, 0));
    const result = await pullWaniKani(
      ctx(http, {
        open: [
          {
            externalId: "reviews:2026-11-11",
            kind: "task",
            title: "Do 42 WaniKani reviews",
          },
        ],
      })
    );
    expect(result.items).toEqual([
      {
        kind: "task",
        externalId: "reviews:2026-11-11",
        title: "Do 42 WaniKani reviews",
        state: "done",
        doneAt: now,
      },
    ]);
  });
});
