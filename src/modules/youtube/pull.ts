/**
 * YouTube's pull: a channel's public counts and the views on its newest
 * upload, as readings. Three reads a pull, 1 quota unit each. A channel that
 * hides its subscribers gets no subscribers reading.
 */
import {
  getChannel,
  newestUpload,
  videoViews,
} from "@/lib/connectors/youtube/client";

import type { PullFn, PulledReading } from "@/modules/connect/pull";

function count(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const pullYoutube: PullFn = async ({ http, secret, config }) => {
  const channel = await getChannel(
    http,
    secret,
    config.channelId || config.channel || "",
    "statistics,contentDetails"
  );
  if (!channel) return { items: [], complete: false, readings: [] };

  const readings: PulledReading[] = [];
  const stats = channel.statistics ?? {};
  const subs = count(stats.subscriberCount);
  if (!stats.hiddenSubscriberCount && subs !== null) {
    readings.push({
      key: "subscribers",
      label: "Subscribers",
      value: subs,
      unit: "count",
    });
  }
  const views = count(stats.viewCount);
  if (views !== null) {
    readings.push({
      key: "views",
      label: "Total views",
      value: views,
      unit: "count",
    });
  }
  const videos = count(stats.videoCount);
  if (videos !== null) {
    readings.push({
      key: "videos",
      label: "Videos",
      value: videos,
      unit: "count",
    });
  }

  let complete = true;
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  if (uploads && (videos ?? 1) > 0) {
    try {
      const id = await newestUpload(http, secret, uploads);
      const video = id ? await videoViews(http, secret, id) : null;
      if (video?.views != null) {
        readings.push({
          key: "latest_views",
          label: "Newest upload views",
          value: video.views,
          unit: "count",
        });
      }
    } catch {
      complete = false;
    }
  }
  return { items: [], complete, readings };
};
