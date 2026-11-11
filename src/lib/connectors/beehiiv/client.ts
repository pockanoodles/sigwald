/**
 * beehiiv's v2 API, read-only. The API key goes in `Authorization: Bearer`.
 * Docs checked:
 * - https://developers.beehiiv.com/api-reference/publications/show (GET
 *   /v2/publications/{publicationId}; `expand` adds `stats`, one of which is
 *   `active_subscriptions`; scope publications:read)
 * - https://developers.beehiiv.com/api-reference/posts/index (GET
 *   /v2/publications/{publicationId}/posts: status draft | confirmed |
 *   archived, limit up to 100, order_by publish_date, direction; each post has
 *   id, title, status, publish_date in Unix seconds, web_url; the answer has
 *   limit, page, total_results, total_pages). A scheduled post is `confirmed`
 *   with a publish_date still ahead.
 * The docs don't show how `expand` is written in a query string; the bracket
 * form `expand[]` is what beehiiv's own examples use elsewhere.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.beehiiv.com/v2";

interface Auth {
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

const headers = (secret: Auth["secret"]) => ({
  Authorization: `Bearer ${secret.key}`,
});

const publication = (config: Auth["config"]) =>
  `${API}/publications/${encodeURIComponent(config.publicationId)}`;

export const verifyBeehiiv: VerifyFn = async ({ http, secret, config }) => {
  const answer = await http.json<{ data: { name: string } }>({
    url: publication(config),
    headers: headers(secret),
  });
  return { label: answer.data.name, config: { name: answer.data.name } };
};

export interface BeehiivPost {
  id: string;
  title: string | null;
  status: "draft" | "confirmed" | "archived" | string;
  /** Unix seconds; when the post was set to go out. */
  publish_date: number | null;
  web_url?: string | null;
  created?: number;
}

/** Posts with one status, up to 100, in the order asked; `complete` is false when there were more. */
export async function postsWith(
  http: Http,
  auth: Auth,
  status: "draft" | "confirmed",
  order: { by: "created" | "publish_date"; direction: "asc" | "desc" }
): Promise<{ posts: BeehiivPost[]; complete: boolean }> {
  const answer = await http.json<{
    data: BeehiivPost[];
    total_pages?: number;
  }>({
    url: `${publication(auth.config)}/posts`,
    query: {
      status,
      limit: 100,
      order_by: order.by,
      direction: order.direction,
    },
    headers: headers(auth.secret),
  });
  return { posts: answer.data, complete: (answer.total_pages ?? 1) <= 1 };
}

/** Active subscribers, from the publication's own stats. */
export async function activeSubscribers(
  http: Http,
  auth: Auth
): Promise<number | null> {
  const answer = await http.json<{
    data: { stats?: { active_subscriptions?: number } };
  }>({
    url: publication(auth.config),
    query: { "expand[]": "stat_active_subscriptions" },
    headers: headers(auth.secret),
  });
  const n = answer.data.stats?.active_subscriptions;
  return typeof n === "number" ? n : null;
}
