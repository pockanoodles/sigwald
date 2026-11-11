/**
 * Plausible's Stats API v2, queries only. One endpoint, POST {site}/api/v2/query,
 * with a JSON body { site_id, metrics, date_range }, and the key as
 * `Authorization: Bearer <key>`. The same API runs on plausible.io and on a
 * self-hosted install, at the address the person types.
 * Docs checked: https://plausible.io/docs/stats-api
 * - Authorization: Bearer key, made as a "Stats API" key; 600 requests/hour
 * - Request: { site_id, metrics, date_range } with date_range one of day,
 *   24h, 7d, 28d, 30d, 91d, month, 6mo, 12mo, year, all, or an ISO8601 pair
 * - Response: { results: [{ metrics: [...], dimensions: [...] }], meta, query }
 *   with no dimensions asked, one row
 * - Metrics: visitors (int), pageviews (int), bounce_rate (float, "Bounce
 *   rate percentage")
 * Unsure: the docs don't say whether bounce_rate runs 0 to 100 or 0 to 1; it
 * is taken as 0 to 100 (a percentage), and may be null when there were no
 * visits. They don't document error bodies either, so an error is reported
 * by its HTTP status.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

interface Auth {
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

export type Metric = "visitors" | "pageviews" | "bounce_rate";
export type DateRange = "day" | "30d";

/** One query with no dimensions: the metrics' totals, in the order asked (null where Plausible has none). */
export async function totals(
  http: Http,
  auth: Auth,
  metrics: readonly Metric[],
  dateRange: DateRange
): Promise<(number | null)[]> {
  const site = (auth.config.site ?? "").replace(/\/+$/, "");
  const answer = await http.json<{
    results: { metrics: (number | null)[] }[];
  }>({
    url: `${site}/api/v2/query`,
    method: "POST",
    headers: { Authorization: `Bearer ${auth.secret.token}` },
    json: {
      site_id: auth.config.domain,
      metrics,
      date_range: dateRange,
    },
  });
  const row = answer.results?.[0]?.metrics ?? [];
  return metrics.map((_, i) => {
    const value = row[i];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
}

export const verifyPlausible: VerifyFn = async ({ http, secret, config }) => {
  await totals(http, { secret, config }, ["visitors"], "day");
  return { label: config.domain };
};
