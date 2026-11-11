/**
 * YouTube Data API v3, read-only: a channel's public counts and the views on
 * its newest upload. Every call costs 1 quota unit.
 * Docs checked:
 * - https://developers.google.com/youtube/v3/docs/channels/list (id or
 *   forHandle, part, quota 1)
 * - https://developers.google.com/youtube/v3/docs/channels (statistics are
 *   unsigned longs, hiddenSubscriberCount, contentDetails.relatedPlaylists.uploads)
 * - https://developers.google.com/youtube/v3/docs/playlistItems/list
 * - https://developers.google.com/youtube/v3/docs/videos
 * - https://docs.cloud.google.com/docs/authentication/api-keys-use (the key
 *   goes in the x-goog-api-key header)
 * Not confirmed by the pages: the order of an uploads playlist (newest first
 * in practice) and playlistItem contentDetails.videoId (it is in the resource).
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://www.googleapis.com/youtube/v3";

export function youtubeHeaders(secret: Readonly<Record<string, string>>) {
  return { "X-Goog-Api-Key": secret.key };
}

export interface YoutubeChannel {
  id: string;
  snippet?: { title?: string };
  statistics?: {
    viewCount?: string | number;
    subscriberCount?: string | number;
    hiddenSubscriberCount?: boolean;
    videoCount?: string | number;
  };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

/** The channel by id (UC…) or by handle (@name), or null when there is none. */
export async function getChannel(
  http: Http,
  secret: Readonly<Record<string, string>>,
  channel: string,
  part: string
): Promise<YoutubeChannel | null> {
  const query = channel.startsWith("@")
    ? { forHandle: channel }
    : { id: channel };
  const res = await http.json<{ items?: YoutubeChannel[] }>({
    url: `${API}/channels`,
    query: { part, ...query },
    headers: youtubeHeaders(secret),
  });
  return res.items?.[0] ?? null;
}

export const verifyYoutube: VerifyFn = async ({ http, secret, config }) => {
  const channel = await getChannel(
    http,
    secret,
    config.channel ?? "",
    "snippet,contentDetails"
  );
  if (!channel) throw new Error("YouTube has no channel by that id or handle");
  const title = channel.snippet?.title ?? config.channel;
  return {
    label: title ?? channel.id,
    config: {
      title: title ?? "",
      channelId: channel.id,
      uploads: channel.contentDetails?.relatedPlaylists?.uploads ?? "",
    },
  };
};

/** The newest upload's video id, or null for a channel with none. */
export async function newestUpload(
  http: Http,
  secret: Readonly<Record<string, string>>,
  playlistId: string
): Promise<string | null> {
  const res = await http.json<{
    items?: { contentDetails?: { videoId?: string } }[];
  }>({
    url: `${API}/playlistItems`,
    query: { part: "contentDetails", playlistId, maxResults: 1 },
    headers: youtubeHeaders(secret),
  });
  return res.items?.[0]?.contentDetails?.videoId ?? null;
}

export async function videoViews(
  http: Http,
  secret: Readonly<Record<string, string>>,
  videoId: string
): Promise<{ title: string; views: number | null } | null> {
  const res = await http.json<{
    items?: {
      snippet?: { title?: string };
      statistics?: { viewCount?: string | number };
    }[];
  }>({
    url: `${API}/videos`,
    query: { part: "snippet,statistics", id: videoId },
    headers: youtubeHeaders(secret),
  });
  const video = res.items?.[0];
  if (!video) return null;
  const views = Number(video.statistics?.viewCount);
  return {
    title: video.snippet?.title ?? "",
    views: Number.isFinite(views) ? views : null,
  };
}
