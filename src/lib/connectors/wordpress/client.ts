/**
 * The WordPress REST API of a self-hosted site (WordPress 5.6 or later),
 * read-only, with HTTP Basic auth: the username and an Application Password
 * (the spaces WordPress shows in it are kept as they are).
 * Docs checked:
 * - https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/
 *   (Application Passwords over Basic auth)
 * - https://developer.wordpress.org/rest-api/reference/users/ (GET
 *   /wp/v2/users/me?context=edit: id, name, username)
 * - https://developer.wordpress.org/rest-api/reference/posts/ (GET /wp/v2/posts:
 *   context, author, status, per_page, include, orderby; id, date_gmt, status,
 *   title, link, modified_gmt; edit context gives title.raw)
 * - https://developer.wordpress.org/rest-api/using-the-rest-api/global-parameters/
 *   (_fields, and the X-WP-TotalPages header)
 */
import type { Http, QueryValue } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

interface Auth {
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

function authorization(auth: Auth): string {
  const pair = `${auth.config.username}:${auth.secret.appPassword}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

export const verifyWordpress: VerifyFn = async ({ http, secret, config }) => {
  const me = await http.json<{ id: number; name: string; username?: string }>({
    url: `${config.site}/wp-json/wp/v2/users/me`,
    query: { context: "edit" },
    headers: { Authorization: authorization({ secret, config }) },
  });
  return {
    label: me.name || me.username || config.username,
    config: { userId: String(me.id) },
  };
};

export interface WpPost {
  id: number;
  status: "draft" | "pending" | "future" | "publish" | string;
  date_gmt: string;
  modified_gmt: string;
  link: string;
  title: { raw?: string; rendered?: string };
}

const FIELDS = "id,status,date_gmt,modified_gmt,link,title";

/** A WordPress GMT time ("2026-11-12T14:00:00", no zone) as a Date. */
export function gmt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(
    /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

async function posts(
  client: Http,
  auth: Auth,
  query: Record<string, QueryValue>
): Promise<{ posts: WpPost[]; complete: boolean }> {
  const response = await client.request({
    url: `${auth.config.site}/wp-json/wp/v2/posts`,
    query: { context: "edit", per_page: 100, _fields: FIELDS, ...query },
    headers: { Authorization: authorization(auth) },
  });
  const pages = Number(response.headers.get("x-wp-totalpages") ?? 1);
  return {
    posts: JSON.parse(response.text) as WpPost[],
    complete: !(pages > 1),
  };
}

/** The author's drafts, pending and scheduled posts (the newest-edited 100). */
export function unpublished(http: Http, auth: Auth) {
  return posts(http, auth, {
    author: auth.config.userId,
    status: "draft,pending,future",
    orderby: "modified",
    order: "desc",
  });
}

/** Those of these post ids that are published now. */
export async function publishedAmong(
  http: Http,
  auth: Auth,
  ids: readonly number[]
): Promise<WpPost[]> {
  if (ids.length === 0) return [];
  const answer = await posts(http, auth, {
    author: auth.config.userId,
    status: "publish",
    include: ids.join(","),
  });
  return answer.posts;
}
