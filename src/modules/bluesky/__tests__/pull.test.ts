import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { BLUESKY } from "@/lib/connectors/bluesky/service";

import bluesky from "@/modules/bluesky/manifest";
import { pullBluesky } from "@/modules/bluesky/pull";
import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";

describe("pullBluesky", () => {
  it("reads the public profile's counts, with or without the @", async () => {
    const { http, calls } = fakeServiceHttp(BLUESKY, [
      {
        url: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
        // As public.api.bsky.app answered on 2026-11-11.
        json: {
          did: "did:plc:z72i7hdynmk6r22z27h6tvur",
          handle: "bsky.app",
          displayName: "Bluesky",
          followersCount: 35620291,
          followsCount: 41,
          postsCount: 919,
        },
      },
    ]);
    const ctx: PullContext = {
      http,
      secret: {},
      config: {},
      settings: resolveSettings(bluesky.connect!.settings, {
        handle: "@bsky.app",
      }),
      now: new Date("2026-11-11T15:00:00.000Z"),
      timeZone: "UTC",
      cursor: null,
      open: [],
      lastSuccessAt: null,
    };
    const result = await pullBluesky(ctx);
    expect(new URL(calls[0].url).searchParams.get("actor")).toBe("bsky.app");
    expect(result.readings).toEqual([
      { key: "followers", label: "Followers", value: 35620291, unit: "count" },
      { key: "following", label: "Following", value: 41, unit: "count" },
      { key: "posts", label: "Posts", value: 919, unit: "count" },
    ]);
  });
});
