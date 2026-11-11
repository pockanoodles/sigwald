/**
 * UptimeRobot's API, version 3 (REST, every read a GET). The older v2, where
 * every call was a POST of a form with `api_key`, is the legacy API: the
 * UptimeRobot API page links to the v3 docs as current and to the v2 docs as
 * "legacy", so this module uses v3 and needs no POST. The API key goes in
 * `Authorization: Bearer <key>`.
 * Docs checked:
 * - https://uptimerobot.com/api/ and https://uptimerobot.com/api/v3/ (v3 is
 *   current; rate limits; HTTP 429 with Retry-After)
 * - https://cdn.uptimerobot.com/api/openapi.yaml (the OpenAPI spec, server
 *   https://api.uptimerobot.com/v3, bearer auth): GET /user/me (email,
 *   fullName); GET /monitors (limit 1 to 200, cursor, status filter of
 *   PAUSED, STARTED, UP, LOOKS_DOWN, DOWN; answers { nextLink, data: [{ id,
 *   friendlyName, status, url, currentStateDuration, ... }] }); GET
 *   /monitors/uptime-stats (timeFrame DAYS_30; overallUptime, a percentage)
 * Unsure: that overallUptime is 0 to 100 (the per-monitor stats say so; the
 * aggregate's description doesn't), and the exact page for making a
 * read-only key in the dashboard.
 */
import type { Http, QueryValue } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.uptimerobot.com/v3";

type Secret = Readonly<Record<string, string>>;

function get<T>(
  http: Http,
  secret: Secret,
  path: string,
  query?: Record<string, QueryValue>
): Promise<T> {
  return http.json<T>({
    url: `${API}${path}`,
    query,
    headers: { Authorization: `Bearer ${secret.key}` },
  });
}

export const verifyUptimeRobot: VerifyFn = async ({ http, secret }) => {
  const me = await get<{ email: string; fullName?: string }>(
    http,
    secret,
    "/user/me"
  );
  return { label: me.fullName || me.email };
};

export interface UptimeRobotMonitor {
  id: number;
  friendlyName: string;
  /** UP, DOWN, LOOKS_DOWN, PAUSED or STARTED. */
  status: string;
  url?: string | null;
  currentStateDuration?: number | null;
}

const PAGE = 200;

/** Every monitor, up to `pages` of 200; `complete` is false when there were more. */
export async function monitors(
  http: Http,
  secret: Secret,
  pages = 5
): Promise<{ monitors: UptimeRobotMonitor[]; complete: boolean }> {
  const all: UptimeRobotMonitor[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < pages; page++) {
    const answer = await get<{
      nextLink?: string | null;
      data: UptimeRobotMonitor[];
    }>(http, secret, "/monitors", { limit: PAGE, cursor });
    all.push(...(answer.data ?? []));
    if (!answer.nextLink) return { monitors: all, complete: true };
    const next = Number(
      new URL(answer.nextLink, API).searchParams.get("cursor")
    );
    if (!Number.isFinite(next) || next === cursor)
      return { monitors: all, complete: false };
    cursor = next;
  }
  return { monitors: all, complete: false };
}

/** Uptime across all monitors over the last 30 days, as a percentage. */
export async function uptime30(http: Http, secret: Secret): Promise<number> {
  const stats = await get<{ overallUptime: number }>(
    http,
    secret,
    "/monitors/uptime-stats",
    { timeFrame: "DAYS_30", logLimit: 1 }
  );
  return stats.overallUptime;
}
