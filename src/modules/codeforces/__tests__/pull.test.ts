import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { CODEFORCES } from "@/lib/connectors/codeforces/service";

import codeforces from "@/modules/codeforces/manifest";
import { pullCodeforces } from "@/modules/codeforces/pull";
import type { PullContext, PulledEvent } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

const now = new Date("2026-11-11T15:00:00.000Z");
const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(codeforces.connect!.settings, settings),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// As codeforces.com answered on 2026-11-11.
const contests = {
  status: "OK",
  result: [
    {
      id: 2282,
      name: "Kotlin Heroes: Episode 15",
      type: "ICPC",
      phase: "BEFORE",
      frozen: false,
      durationSeconds: 9000,
      startTimeSeconds: at("2026-11-20T14:35:00Z"),
    },
    {
      id: 2300,
      name: "Far away round",
      type: "CF",
      phase: "BEFORE",
      frozen: false,
      durationSeconds: 7200,
      startTimeSeconds: at("2027-02-01T14:35:00Z"),
    },
    {
      id: 2200,
      name: "Finished round",
      type: "CF",
      phase: "FINISHED",
      frozen: false,
      durationSeconds: 7200,
      startTimeSeconds: at("2026-11-01T14:35:00Z"),
    },
  ],
};

describe("pullCodeforces", () => {
  it("puts the next month's rounds on the calendar and reads the rating", async () => {
    const { http } = fakeServiceHttp(CODEFORCES, [
      { url: "https://codeforces.com/api/contest.list", json: contests },
      {
        url: "https://codeforces.com/api/user.info",
        json: {
          status: "OK",
          result: [
            {
              handle: "tourist",
              rating: 3408,
              maxRating: 4009,
              rank: "legendary grandmaster",
            },
          ],
        },
      },
    ]);
    const result = await pullCodeforces(ctx(http, { handle: "tourist" }));
    const events = result.items as PulledEvent[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      externalId: "2282",
      title: "Kotlin Heroes: Episode 15",
      busy: false,
      start: new Date("2026-11-20T14:35:00Z"),
      end: new Date("2026-11-20T17:05:00Z"),
      url: "https://codeforces.com/contests/2282",
    });
    expect(result.readings).toEqual([
      { key: "rating", label: "Rating", value: 3408, unit: "count" },
      { key: "maxrating", label: "Best rating", value: 4009, unit: "count" },
    ]);
  });

  it("reads Codeforces' FAILED answer as a refusal, in its own words", async () => {
    const { http } = fakeServiceHttp(CODEFORCES, [
      {
        url: "https://codeforces.com/api/user.info",
        json: {
          status: "FAILED",
          comment: "handles: User with handle nobody not found",
        },
      },
    ]);
    await expect(
      pullCodeforces(ctx(http, { handle: "nobody", rounds: false }))
    ).rejects.toMatchObject({
      kind: "config",
      message: expect.stringContaining("not found"),
    });
  });
});
