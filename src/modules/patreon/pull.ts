/**
 * Patreon's pull: the patron count of the creator's campaign(s), summed. A
 * campaign that keeps its count private answers null, and then there is no
 * reading rather than a zero.
 */
import { listCampaigns } from "@/lib/connectors/patreon/client";

import type { PullFn } from "@/modules/connect/pull";

export const pullPatreon: PullFn = async ({ http, secret }) => {
  const campaigns = await listCampaigns(http, secret);
  const counts = campaigns
    .map((c) => c.attributes?.patron_count)
    .filter((n): n is number => typeof n === "number");
  if (counts.length === 0) return { items: [], complete: true, readings: [] };
  return {
    items: [],
    complete: counts.length === campaigns.length,
    readings: [
      {
        key: "patrons",
        label: "Patrons",
        value: counts.reduce((a, b) => a + b, 0),
        unit: "count",
      },
    ],
  };
};
