/**
 * Jira Cloud's REST API v3, read-only: who the token is, and the JQL search.
 * The old /rest/api/3/search was removed from Jira Cloud; the current one is
 * /rest/api/3/search/jql, which pages by an opaque nextPageToken and returns
 * no total. It answers with only issue ids unless `fields` is given, so every
 * search names the fields it maps (and never the description, which is ADF).
 * Docs checked:
 * - https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
 *   (Basic auth with email:api_token)
 * - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
 *   (search/jql: jql, fields, maxResults, nextPageToken)
 * - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/
 *   (GET /myself)
 * - https://support.atlassian.com/jira/kb/how-to-search-using-statuscategory-statuscategorychangeddate-function-with-jql/
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const PAGE = 100;

export function jiraHeaders(
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>
) {
  const basic = Buffer.from(`${config.email}:${secret.token}`).toString(
    "base64"
  );
  return { Authorization: `Basic ${basic}`, Accept: "application/json" };
}

export function apiBase(config: Readonly<Record<string, string>>): string {
  return `${(config.site ?? "").replace(/\/+$/, "")}/rest/api/3`;
}

export const verifyJira: VerifyFn = async ({ http, secret, config }) => {
  const me = await http.json<{ displayName?: string; accountId: string }>({
    url: `${apiBase(config)}/myself`,
    headers: jiraHeaders(secret, config),
  });
  return { label: me.displayName ?? me.accountId };
};

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    duedate?: string | null;
    priority?: { name: string } | null;
    status?: { name: string; statusCategory?: { key: string } } | null;
    project?: { key: string; name: string } | null;
    issuetype?: { name: string } | null;
    labels?: string[];
    updated?: string;
    statuscategorychangedate?: string | null;
  };
}

/** The fields every search asks for: only what the pull maps. */
export const FIELDS = [
  "summary",
  "duedate",
  "priority",
  "status",
  "project",
  "issuetype",
  "labels",
  "updated",
  "statuscategorychangedate",
];

/**
 * One issue's status, by key: how a held issue that dropped off the open
 * search is told apart (done, someone else's, or deleted, which answers 404).
 * GET /rest/api/3/issue/{issueIdOrKey}
 * (https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get)
 */
export function getIssue(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>,
  key: string
): Promise<JiraIssue> {
  return http.json<JiraIssue>({
    url: `${apiBase(config)}/issue/${encodeURIComponent(key)}`,
    query: { fields: "status,updated,statuscategorychangedate" },
    headers: jiraHeaders(secret, config),
  });
}

interface SearchPage {
  issues: JiraIssue[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

/**
 * Up to `pages` pages of one JQL search. `complete` is false when Jira said
 * there was more than was read.
 */
export async function searchJql(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>,
  jql: string,
  pages = 3
): Promise<{ issues: JiraIssue[]; complete: boolean }> {
  const issues: JiraIssue[] = [];
  let token: string | null = null;
  for (let n = 0; n < pages; n++) {
    const res: SearchPage = await http.json<SearchPage>({
      url: `${apiBase(config)}/search/jql`,
      query: {
        jql,
        fields: FIELDS.join(","),
        maxResults: PAGE,
        nextPageToken: token,
      },
      headers: jiraHeaders(secret, config),
    });
    issues.push(...res.issues);
    if (res.isLast || !res.nextPageToken) return { issues, complete: true };
    token = res.nextPageToken;
  }
  return { issues, complete: false };
}
