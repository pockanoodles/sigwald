/**
 * PagerDuty's REST API v2, read-only: who the token is, your on-call shifts,
 * the incidents assigned to you, and one incident by id. A user API token is
 * sent as `Authorization: Token token=<key>` with the v2 Accept header.
 * Docs checked:
 * - https://docs.pagerduty.com/developer/api/reference/rest/users/get-current-user
 *   (GET /users/me, user tokens only)
 * - https://docs.pagerduty.com/developer/api/reference/rest/on-calls/list-on-calls
 *   (user_ids[], since, until, limit, offset)
 * - https://docs.pagerduty.com/developer/api/reference/rest/incidents/list-incidents
 *   (statuses[], user_ids[] matches triggered or acknowledged only, limit, offset, more)
 * - https://developer.pagerduty.com/api-reference/ (GET /incidents/{id})
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.pagerduty.com";
const PAGE = 100;

export function pagerdutyHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `Token token=${secret.token}`,
    Accept: "application/vnd.pagerduty+json;version=2",
  };
}

export const verifyPagerduty: VerifyFn = async ({ http, secret }) => {
  const res = await http.json<{
    user: { id: string; name?: string; email?: string };
  }>({ url: `${API}/users/me`, headers: pagerdutyHeaders(secret) });
  return {
    label: res.user.name ?? res.user.email ?? res.user.id,
    config: { userId: res.user.id },
  };
};

interface Ref {
  id: string;
  summary?: string;
  html_url?: string | null;
}

export interface PagerdutyOncall {
  escalation_level: number;
  start: string | null;
  end: string | null;
  schedule: Ref | null;
  escalation_policy: Ref;
}

export interface PagerdutyIncident {
  id: string;
  incident_number: number;
  title: string;
  status: "triggered" | "acknowledged" | "resolved";
  urgency: "high" | "low";
  html_url: string;
  created_at: string;
  resolved_at?: string | null;
  last_status_change_at?: string | null;
  service?: Ref | null;
}

interface Paged {
  more?: boolean;
}

async function pages<K extends string, T>(
  http: Http,
  secret: Readonly<Record<string, string>>,
  path: string,
  key: K,
  query: Record<string, string | number | readonly string[]>,
  max: number
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let n = 0; n < max; n++) {
    const res = await http.json<Paged & Record<K, T[]>>({
      url: `${API}${path}`,
      query: { ...query, limit: PAGE, offset: n * PAGE },
      headers: pagerdutyHeaders(secret),
    });
    items.push(...res[key]);
    if (!res.more) return { items, complete: true };
  }
  return { items, complete: false };
}

/** Your on-call shifts that touch since..until. */
export function listOncalls(
  http: Http,
  secret: Readonly<Record<string, string>>,
  userId: string,
  since: Date,
  until: Date
) {
  return pages<"oncalls", PagerdutyOncall>(
    http,
    secret,
    "/oncalls",
    "oncalls",
    {
      "user_ids[]": [userId],
      since: since.toISOString(),
      until: until.toISOString(),
    },
    3
  );
}

/** Incidents assigned to you that are triggered or acknowledged. */
export function listAssignedIncidents(
  http: Http,
  secret: Readonly<Record<string, string>>,
  userId: string
) {
  return pages<"incidents", PagerdutyIncident>(
    http,
    secret,
    "/incidents",
    "incidents",
    {
      "user_ids[]": [userId],
      "statuses[]": ["triggered", "acknowledged"],
      sort_by: "created_at:desc",
    },
    3
  );
}

export async function getIncident(
  http: Http,
  secret: Readonly<Record<string, string>>,
  id: string
): Promise<PagerdutyIncident> {
  const res = await http.json<{ incident: PagerdutyIncident }>({
    url: `${API}/incidents/${encodeURIComponent(id)}`,
    headers: pagerdutyHeaders(secret),
  });
  return res.incident;
}
