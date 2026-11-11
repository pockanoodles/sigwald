import type { ServiceManifest } from "@/lib/connectors/types";

/** Bluesky's public AppView, which serves profiles without signing in. https://docs.bsky.app/docs/api/app-bsky-actor-get-profile */
export const BLUESKY: ServiceManifest = {
  id: "bluesky",
  name: "Bluesky",
  homepage: "https://bsky.app",
  fields: [],
  host: { kind: "fixed", hosts: ["public.api.bsky.app"] },
  egress: {
    to: "Bluesky (public.api.bsky.app)",
    sends: "The handle you set",
    why: "To read its public follower, following and post counts. Nothing is written back.",
  },
};
