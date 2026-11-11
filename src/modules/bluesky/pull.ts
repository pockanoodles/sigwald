/**
 * Bluesky's pull: the public profile's counts, from the AppView that serves
 * them without signing in.
 * Docs: https://docs.bsky.app/docs/api/app-bsky-actor-get-profile
 */
import type { PullFn } from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

interface Profile {
  handle: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
}

export const pullBluesky: PullFn = async ({ http, settings }) => {
  const actor = setting.text(settings, "handle").replace(/^@/, "");
  const p = await http.json<Profile>({
    url: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
    query: { actor },
  });
  const readings = [
    { key: "followers", label: "Followers", value: p.followersCount },
    { key: "following", label: "Following", value: p.followsCount },
    { key: "posts", label: "Posts", value: p.postsCount },
  ].flatMap((r) =>
    typeof r.value === "number" ? [{ ...r, value: r.value, unit: "count" }] : []
  );
  return { items: [], complete: true, readings };
};
