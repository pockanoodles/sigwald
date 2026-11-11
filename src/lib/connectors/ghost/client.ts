/**
 * Ghost's Admin API, read-only. Every request carries a JWT signed here from
 * the Admin API key (HS256, header kid = the key's id, audience "/admin/",
 * expires within 5 minutes, signed with the hex-decoded secret) as
 * `Authorization: Ghost <jwt>`, with an `Accept-Version` header.
 * Docs checked:
 * - https://docs.ghost.org/admin-api (token authentication, Accept-Version,
 *   base URL {site}/ghost/api/admin/, browse params filter/limit/fields/order,
 *   meta.pagination with total and next)
 * - https://docs.ghost.org/admin-api/site/ (GET /site/: title, url, version; it
 *   needs no key, so verify also makes one signed read)
 * - https://docs.ghost.org/admin-api/posts/ (GET /posts/; id, title, status,
 *   published_at, updated_at, url)
 * - https://docs.ghost.org/admin-api/members/ (GET /members/, status values)
 * The filter syntax (status:draft, id:[a,b]) is Ghost's NQL, from the Content
 * API's parameters page.
 */
import { createHmac } from "node:crypto";

import type { Http, QueryValue } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const ACCEPT_VERSION = "v5.0";
const TOKEN_LIFETIME_SECONDS = 240;

const b64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64url");

/** The short-lived token Ghost's Admin API wants, signed from the Admin API key. */
export function signAdminToken(adminKey: string, nowMs: number): string {
  const [id, secret] = adminKey.split(":");
  if (!id || !secret || !/^[a-fA-F0-9]+$/.test(secret)) {
    throw new ConnectorError(
      "config",
      "The Admin API key isn't in id:secret form"
    );
  }
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", kid: id, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat, exp: iat + TOKEN_LIFETIME_SECONDS, aud: "/admin/" })
  );
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

interface Auth {
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

const base = (config: Auth["config"]) => `${config.site}/ghost/api/admin`;

/** One read of an Admin API path ("/posts/"), signed fresh. */
export function adminGet<T>(
  http: Http,
  auth: Auth,
  path: string,
  query?: Record<string, QueryValue>
): Promise<T> {
  return http.json<T>({
    url: `${base(auth.config)}${path}`,
    query,
    headers: {
      Authorization: `Ghost ${signAdminToken(auth.secret.adminKey, Date.now())}`,
      "Accept-Version": ACCEPT_VERSION,
    },
  });
}

export const verifyGhost: VerifyFn = async ({ http, secret, config }) => {
  // /site/ is public, so it names the site; a signed read proves the key.
  const site = await http.json<{ site: { title: string } }>({
    url: `${base(config)}/site/`,
    headers: { "Accept-Version": ACCEPT_VERSION },
  });
  await adminGet(http, { secret, config }, "/posts/", {
    limit: 1,
    fields: "id",
  });
  return { label: site.site.title, config: { title: site.site.title } };
};

export interface GhostPost {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  published_at: string | null;
  url?: string;
}

const POST_FIELDS = "id,title,status,updated_at,published_at,url";

/** Posts with one status, newest-edited first, up to 100; `complete` is false when there were more. */
export async function postsWith(
  http: Http,
  auth: Auth,
  filter: string,
  order = "updated_at desc"
): Promise<{ posts: GhostPost[]; complete: boolean }> {
  const answer = await adminGet<{
    posts: GhostPost[];
    meta?: { pagination?: { next?: number | null } };
  }>(http, auth, "/posts/", { filter, limit: 100, fields: POST_FIELDS, order });
  return {
    posts: answer.posts,
    complete: !answer.meta?.pagination?.next,
  };
}

/** Those of these post ids that are published now (up to 100). */
export async function publishedAmong(
  http: Http,
  auth: Auth,
  ids: readonly string[]
): Promise<GhostPost[]> {
  if (ids.length === 0) return [];
  const answer = await adminGet<{ posts: GhostPost[] }>(http, auth, "/posts/", {
    filter: `id:[${ids.join(",")}]+status:published`,
    limit: 100,
    fields: POST_FIELDS,
  });
  return answer.posts;
}

/** How many members the site has, from one member of a list and its pagination total. */
export async function memberTotal(
  http: Http,
  auth: Auth
): Promise<number | null> {
  const answer = await adminGet<{
    meta?: { pagination?: { total?: number } };
  }>(http, auth, "/members/", { limit: 1, fields: "id" });
  const total = answer.meta?.pagination?.total;
  return typeof total === "number" ? total : null;
}
