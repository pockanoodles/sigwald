/**
 * Kit's v4 API (formerly ConvertKit), read-only. A v4 API key goes in the
 * X-Kit-Api-Key header (never as a Bearer token, which Kit treats as OAuth).
 * Docs checked:
 * - https://developers.kit.com/api-reference/authentication (the header; API
 *   keys reach everything used here, only the bulk and purchase endpoints need
 *   OAuth; 120 requests a minute)
 * - https://developers.kit.com/api-reference/accounts/get-current-account (GET
 *   /v4/account: account.name, account.id, user.email)
 * - https://developers.kit.com/api-reference/broadcasts/list-broadcasts (GET
 *   /v4/broadcasts: status draft | scheduled | sending | completed | aborted,
 *   per_page up to 1000, sent_after as yyyy-mm-dd, slim, subject, send_at,
 *   published_at, and a pagination object with has_next_page)
 * - https://developers.kit.com/api-reference/subscribers/list-subscribers (GET
 *   /v4/subscribers: status defaults to active, include_total_count adds
 *   total_count). The docs don't show where total_count sits in the answer, so
 *   both `pagination.total_count` and a top-level `total_count` are read.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.kit.com/v4";

const headers = (secret: Readonly<Record<string, string>>) => ({
  "X-Kit-Api-Key": secret.key,
});

export const verifyKit: VerifyFn = async ({ http, secret }) => {
  const answer = await http.json<{
    user?: { email?: string };
    account: {
      id: number | string;
      name: string;
      primary_email_address?: string;
    };
  }>({ url: `${API}/account`, headers: headers(secret) });
  const name =
    answer.account.name ||
    answer.account.primary_email_address ||
    answer.user?.email ||
    "Kit";
  return {
    label: name,
    config: { name, accountId: String(answer.account.id) },
  };
};

export interface KitBroadcast {
  id: number;
  subject: string | null;
  status?: string;
  created_at: string;
  send_at: string | null;
  published_at: string | null;
}

/** Broadcasts with one status, up to 100; `complete` is false when there were more. */
export async function broadcastsWith(
  http: Http,
  secret: Readonly<Record<string, string>>,
  status: "draft" | "scheduled" | "completed",
  sentAfter?: string
): Promise<{ broadcasts: KitBroadcast[]; complete: boolean }> {
  const answer = await http.json<{
    broadcasts: KitBroadcast[];
    pagination?: { has_next_page?: boolean };
  }>({
    url: `${API}/broadcasts`,
    query: {
      status,
      per_page: 100,
      slim: true,
      sent_after: sentAfter,
    },
    headers: headers(secret),
  });
  return {
    broadcasts: answer.broadcasts,
    complete: !answer.pagination?.has_next_page,
  };
}

/** Active subscribers, from one subscriber of a list and its total count. */
export async function activeSubscribers(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<number | null> {
  const answer = await http.json<{
    total_count?: number;
    pagination?: { total_count?: number };
  }>({
    url: `${API}/subscribers`,
    query: { status: "active", per_page: 1, include_total_count: true },
    headers: headers(secret),
  });
  const n = answer.pagination?.total_count ?? answer.total_count;
  return typeof n === "number" ? n : null;
}
