/**
 * Sentry's web API, read-only: the organization (to check the token), the
 * organization's issue search, and one issue by id. Region organizations are
 * served from us.sentry.io or de.sentry.io, so the host comes from the
 * connection's `region` (default sentry.io).
 * Docs checked:
 * - https://docs.sentry.io/api/auth/ (Authorization: Bearer)
 * - https://docs.sentry.io/api/organizations/retrieve-an-organization/ (org:read)
 * - https://docs.sentry.io/api/events/list-an-organizations-issues/ (query,
 *   limit up to 100, cursor, event:read)
 * - https://docs.sentry.io/api/events/retrieve-an-issue/ (status)
 * - https://docs.sentry.io/api/pagination/ (Link header, results="true")
 * - https://docs.sentry.io/organization/data-storage-location/ (region hosts)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

export function sentryHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `Bearer ${secret.token}`,
    Accept: "application/json",
  };
}

export function apiBase(config: Readonly<Record<string, string>>): string {
  return `https://${config.region || "sentry.io"}/api/0`;
}

export const verifySentry: VerifyFn = async ({ http, secret, config }) => {
  const org = await http.json<{ slug: string; name?: string }>({
    url: `${apiBase(config)}/organizations/${encodeURIComponent(config.org)}/`,
    headers: sentryHeaders(secret),
  });
  return { label: org.name ?? org.slug };
};

export interface SentryIssue {
  id: string;
  shortId?: string;
  title: string;
  level?: string;
  status?: string;
  permalink?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  project?: { slug: string; name: string };
}

/** The `cursor` of the Link header's next page, or null on the last page. */
export function nextCursor(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(/,(?=\s*<)/)) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) {
      return part.match(/cursor="([^"]+)"/)?.[1] ?? null;
    }
  }
  return null;
}

/** Up to `pages` pages of an issue search; `complete` is false when more were left. */
export async function searchIssues(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>,
  query: string,
  pages = 3
): Promise<{ issues: SentryIssue[]; complete: boolean }> {
  const issues: SentryIssue[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < pages; n++) {
    const res = await http.request({
      url: `${apiBase(config)}/organizations/${encodeURIComponent(config.org)}/issues/`,
      query: { query, limit: 100, sort: "date", cursor },
      headers: sentryHeaders(secret),
    });
    let body: unknown;
    try {
      body = JSON.parse(res.text);
    } catch {
      throw new ConnectorError("bad_response", "Sentry sent something odd");
    }
    if (!Array.isArray(body)) {
      throw new ConnectorError("bad_response", "Sentry sent something odd");
    }
    issues.push(...(body as SentryIssue[]));
    cursor = nextCursor(res.headers.get("link"));
    if (!cursor) return { issues, complete: true };
  }
  return { issues, complete: false };
}

export function getIssue(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>,
  id: string
): Promise<SentryIssue> {
  return http.json<SentryIssue>({
    url: `${apiBase(config)}/organizations/${encodeURIComponent(config.org)}/issues/${encodeURIComponent(id)}/`,
    headers: sentryHeaders(secret),
  });
}
