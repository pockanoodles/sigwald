/**
 * GitHub's REST API, read-only: who the token is, and the issue search.
 * Docs: https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests
 * and https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.github.com";
const PER_PAGE = 100;

export function githubHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `Bearer ${secret.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export const verifyGithub: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{ login: string }>({
    url: `${API}/user`,
    headers: githubHeaders(secret),
  });
  return { label: `@${me.login}`, config: { login: me.login } };
};

export interface GithubIssue {
  number: number;
  title: string;
  html_url: string;
  /** https://api.github.com/repos/{owner}/{repo} */
  repository_url: string;
  state: "open" | "closed";
  body: string | null;
  labels: ({ name?: string } | string)[];
  milestone: { title: string; due_on: string | null } | null;
  user: { login: string } | null;
  comments: number;
  updated_at: string;
  closed_at: string | null;
  draft?: boolean;
  pull_request?: { merged_at: string | null };
}

interface SearchPage {
  total_count: number;
  incomplete_results: boolean;
  items: GithubIssue[];
}

/**
 * Every result of one issue search, newest-updated first, up to `pages` of
 * 100. `complete` is false when GitHub said its answer was partial or there
 * were more than were read.
 */
export async function searchIssues(
  http: Http,
  secret: Readonly<Record<string, string>>,
  q: string,
  pages = 2
): Promise<{ items: GithubIssue[]; complete: boolean }> {
  const items: GithubIssue[] = [];
  let complete = true;
  for (let page = 1; page <= pages; page++) {
    const res = await http.json<SearchPage>({
      url: `${API}/search/issues`,
      query: { q, per_page: PER_PAGE, page, sort: "updated", order: "desc" },
      headers: githubHeaders(secret),
    });
    items.push(...res.items);
    if (res.incomplete_results) complete = false;
    if (items.length >= res.total_count || res.items.length < PER_PAGE) {
      return { items, complete };
    }
  }
  return { items, complete: false };
}

/** "owner/name", lowercase, from an issue's repository_url. */
export function repoOf(issue: Pick<GithubIssue, "repository_url">): string {
  const match = issue.repository_url.match(/\/repos\/([^/]+\/[^/]+)$/);
  return (match?.[1] ?? "unknown/unknown").toLowerCase();
}
