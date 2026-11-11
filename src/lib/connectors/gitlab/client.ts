/**
 * GitLab's REST API v4, read-only: who the token is, and the issue and merge
 * request lists. Works on gitlab.com and on a self-hosted site, so every URL
 * is built from the connection's `site`.
 * Docs checked:
 * - https://docs.gitlab.com/api/rest/authentication/ (PRIVATE-TOKEN header)
 * - https://docs.gitlab.com/api/issues/ (scope, state, updated_after,
 *   references.full, milestone)
 * - https://docs.gitlab.com/api/merge_requests/ (reviewer_username, scope=all,
 *   state opened/closed/merged, no due date of its own)
 * - https://docs.gitlab.com/api/rest/ (offset pagination, x-next-page header)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const PER_PAGE = 100;

export function gitlabHeaders(secret: Readonly<Record<string, string>>) {
  return { "PRIVATE-TOKEN": secret.token, Accept: "application/json" };
}

export function apiBase(config: Readonly<Record<string, string>>): string {
  return `${(config.site ?? "").replace(/\/+$/, "")}/api/v4`;
}

export const verifyGitlab: VerifyFn = async ({ http, secret, config }) => {
  const me = await http.json<{ username: string; name?: string }>({
    url: `${apiBase(config)}/user`,
    headers: gitlabHeaders(secret),
  });
  return { label: `@${me.username}`, config: { username: me.username } };
};

export interface GitlabItem {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string | null;
  web_url: string;
  state: string;
  labels: string[];
  due_date?: string | null;
  milestone?: { title: string; due_date?: string | null } | null;
  references: { full: string };
  author?: { username: string } | null;
  updated_at: string;
  closed_at?: string | null;
  merged_at?: string | null;
  draft?: boolean;
  user_notes_count?: number;
}

/**
 * Up to `pages` pages of one list, following GitLab's x-next-page header.
 * `complete` is false when there were more pages than were read.
 */
export async function listAll(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>,
  path: "issues" | "merge_requests",
  query: Record<string, string | number>,
  pages = 3
): Promise<{ items: GitlabItem[]; complete: boolean }> {
  const items: GitlabItem[] = [];
  let page = 1;
  for (let n = 0; n < pages; n++) {
    const res = await http.request({
      url: `${apiBase(config)}/${path}`,
      query: { ...query, per_page: PER_PAGE, page },
      headers: gitlabHeaders(secret),
    });
    let body: unknown;
    try {
      body = JSON.parse(res.text);
    } catch {
      throw new ConnectorError("bad_response", "GitLab sent something odd");
    }
    if (!Array.isArray(body)) {
      throw new ConnectorError("bad_response", "GitLab sent something odd");
    }
    items.push(...(body as GitlabItem[]));
    const next = Number(res.headers.get("x-next-page"));
    if (!Number.isFinite(next) || next <= 0) return { items, complete: true };
    page = next;
  }
  return { items, complete: false };
}

/** "group/sub/project", lowercase, from an item's references.full ("group/project#6" or "group/project!12"). */
export function projectPath(item: Pick<GitlabItem, "references">): string {
  return item.references.full.replace(/[#!]\d+$/, "").toLowerCase();
}
