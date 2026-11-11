/**
 * Linear's GraphQL API, queries only. Personal API keys go in the
 * Authorization header as they are, without "Bearer".
 * Docs: https://linear.app/developers/graphql
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError, isConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.linear.app/graphql";

export async function linearQuery<T>(
  http: Http,
  secret: Readonly<Record<string, string>>,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  let answer: {
    data?: T;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  try {
    answer = await http.json({
      url: API,
      method: "POST",
      headers: { Authorization: secret.key },
      json: { query, variables },
    });
  } catch (error) {
    // Linear says a bad key with a 400 and an AUTHENTICATION_ERROR.
    if (
      isConnectorError(error) &&
      error.kind === "bad_response" &&
      /authenticat/i.test(error.message)
    ) {
      throw new ConnectorError("auth", "Linear refused the key", error.status);
    }
    throw error;
  }
  const first = answer.errors?.[0];
  if (first) {
    const auth =
      first.extensions?.code === "AUTHENTICATION_ERROR" ||
      /authenticat/i.test(first.message);
    throw new ConnectorError(
      auth ? "auth" : "bad_response",
      `Linear: ${first.message}`.slice(0, 200)
    );
  }
  if (!answer.data)
    throw new ConnectorError("bad_response", "Linear answered without data");
  return answer.data;
}

export const verifyLinear: VerifyFn = async ({ http, secret }) => {
  const data = await linearQuery<{
    viewer: { id: string; name: string; email: string };
  }>(http, secret, "query { viewer { id name email } }");
  return {
    label: data.viewer.name || data.viewer.email,
    config: { viewerId: data.viewer.id },
  };
};

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel: string;
  dueDate: string | null;
  estimate: number | null;
  updatedAt: string;
  completedAt?: string | null;
  description: string | null;
  state: { name: string; type: string };
  team: { key: string; name: string };
  project: { id: string; name: string } | null;
  cycle: { number: number; endsAt: string } | null;
  labels: { nodes: { name: string }[] };
}

const ISSUE_FIELDS = `
  id identifier title url priority priorityLabel dueDate estimate updatedAt description
  state { name type }
  team { key name }
  project { id name }
  cycle { number endsAt }
  labels { nodes { name } }
`;

/** The open issues assigned to the key's owner, up to `pages` of 100. */
export async function assignedOpenIssues(
  http: Http,
  secret: Readonly<Record<string, string>>,
  pages = 3
): Promise<{ issues: LinearIssue[]; complete: boolean }> {
  const issues: LinearIssue[] = [];
  let after: string | null = null;
  for (let page = 0; page < pages; page++) {
    const data: {
      viewer: {
        assignedIssues: {
          nodes: LinearIssue[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    } = await linearQuery(
      http,
      secret,
      `query Assigned($after: String) {
        viewer {
          assignedIssues(
            first: 100
            after: $after
            orderBy: updatedAt
            filter: { state: { type: { nin: ["completed", "canceled"] } } }
          ) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { after }
    );
    const connection = data.viewer.assignedIssues;
    issues.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return { issues, complete: true };
    after = connection.pageInfo.endCursor;
  }
  return { issues, complete: false };
}

/** Issues assigned to the key's owner that were completed since `since`. */
export async function assignedCompletedSince(
  http: Http,
  secret: Readonly<Record<string, string>>,
  since: Date
): Promise<{ id: string; completedAt: string }[]> {
  const data = await linearQuery<{
    viewer: {
      assignedIssues: { nodes: { id: string; completedAt: string | null }[] };
    };
  }>(
    http,
    secret,
    `query Finished($since: DateTimeOrDuration!) {
      viewer {
        assignedIssues(first: 100, filter: { completedAt: { gte: $since } }) {
          nodes { id completedAt }
        }
      }
    }`,
    { since: since.toISOString() }
  );
  return data.viewer.assignedIssues.nodes.flatMap((n) =>
    n.completedAt ? [{ id: n.id, completedAt: n.completedAt }] : []
  );
}
