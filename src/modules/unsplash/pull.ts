/**
 * Unsplash's pull: a photographer's downloads and views over the last 30
 * days, and their downloads of all time. The 30-day figures are the sum of
 * the daily values, so they mean the same whatever `total` counts; a series
 * that comes back without values falls back to its `total`.
 */
import {
  cleanUsername,
  getProfile,
  getStatistics,
} from "@/lib/connectors/unsplash/client";

import type { PullFn, PulledReading } from "@/modules/connect/pull";

function windowSum(
  series:
    | {
        total?: number;
        historical?: { values?: { value?: number }[] };
      }
    | undefined
): number | null {
  const values = series?.historical?.values;
  if (values && values.length > 0) {
    return values.reduce((sum, v) => sum + (v.value ?? 0), 0);
  }
  return typeof series?.total === "number" ? series.total : null;
}

export const pullUnsplash: PullFn = async ({ http, secret, config }) => {
  const username = cleanUsername(config.username);
  const readings: PulledReading[] = [];
  let complete = true;

  const stats = await getStatistics(http, secret, username);
  const downloads = windowSum(stats.downloads);
  const views = windowSum(stats.views);
  if (downloads !== null) {
    readings.push({
      key: "downloads30",
      label: "Downloads, 30 days",
      value: downloads,
      unit: "count",
    });
  }
  if (views !== null) {
    readings.push({
      key: "views30",
      label: "Views, 30 days",
      value: views,
      unit: "count",
    });
  }

  try {
    const profile = await getProfile(http, secret, username);
    if (typeof profile.downloads === "number") {
      readings.push({
        key: "downloads_total",
        label: "Downloads, all time",
        value: profile.downloads,
        unit: "count",
      });
    }
  } catch {
    complete = false;
  }
  return { items: [], complete, readings };
};
