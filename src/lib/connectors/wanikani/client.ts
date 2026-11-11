/**
 * WaniKani's API v2, reads only. The token goes in `Authorization: Bearer`,
 * and every call names the API revision in `Wanikani-Revision`.
 * Docs checked: https://docs.api.wanikani.com/20170710/
 * - Authentication: Bearer token; `Wanikani-Revision: 20170710` (the first
 *   revision, which the API assumes if the header is missing)
 * - GET /v2/user: { data: { username, level, ... } }
 * - GET /v2/summary: { data: { lessons: [{ available_at, subject_ids }],
 *   reviews: [{ available_at, subject_ids }] (the current hour and the next
 *   24), next_reviews_at } }. The report changes once an hour.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.wanikani.com/v2";
const REVISION = "20170710";

type Secret = Readonly<Record<string, string>>;

function get<T>(http: Http, secret: Secret, path: string): Promise<T> {
  return http.json<T>({
    url: `${API}${path}`,
    headers: {
      Authorization: `Bearer ${secret.token}`,
      "Wanikani-Revision": REVISION,
    },
  });
}

export interface WaniKaniUser {
  data: { username: string; level: number };
}

export function user(http: Http, secret: Secret): Promise<WaniKaniUser> {
  return get<WaniKaniUser>(http, secret, "/user");
}

export const verifyWaniKani: VerifyFn = async ({ http, secret }) => {
  const me = await user(http, secret);
  return {
    label: me.data.username,
    config: { level: String(me.data.level) },
  };
};

interface Slot {
  available_at: string;
  subject_ids: number[];
}

export interface WaniKaniSummary {
  data: {
    lessons: Slot[];
    reviews: Slot[];
    next_reviews_at: string | null;
  };
}

export function summary(http: Http, secret: Secret): Promise<WaniKaniSummary> {
  return get<WaniKaniSummary>(http, secret, "/summary");
}
