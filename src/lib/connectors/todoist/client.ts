/**
 * Todoist's API v1 (the unified API that replaced REST v2 and Sync v9),
 * read-only. The token goes in a Bearer header.
 * Docs checked: https://developer.todoist.com/api/v1/
 * - GET /api/v1/user (id, full_name, email)
 * - GET /api/v1/tasks: active tasks, `limit` up to 200, `cursor`; answers
 *   `{ results, next_cursor }`. It has no assignee filter.
 * - GET /api/v1/projects: `{ results, next_cursor }`
 * - GET /api/v1/tasks/completed/by_completion_date: `since` and `until`
 *   required, a range of up to 3 months; answers `{ items, next_cursor }`.
 * - A task's link is https://app.todoist.com/app/task/<id>.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.todoist.com/api/v1";
const LIMIT = 200;

export function todoistHeaders(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.token}` };
}

export const verifyTodoist: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{
    id: string | number;
    full_name?: string;
    email?: string;
  }>({ url: `${API}/user`, headers: todoistHeaders(secret) });
  return {
    label: me.full_name || me.email || String(me.id),
    config: { userId: String(me.id) },
  };
};

export interface TodoistDue {
  /** YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS (floating) or with a Z (fixed zone). */
  date: string;
  timezone?: string | null;
  is_recurring?: boolean;
}

export interface TodoistTask {
  id: string;
  content: string;
  description?: string | null;
  project_id: string;
  responsible_uid?: string | null;
  /** 4 is p1 (urgent) on Todoist's own screens, 1 is normal. */
  priority: number;
  labels?: string[];
  due?: TodoistDue | null;
  deadline?: { date: string } | null;
  updated_at?: string | null;
  completed_at?: string | null;
}

/** Follows `next_cursor` for up to `pages` pages; `complete` is false when it stopped early. */
async function paged<T>(
  http: Http,
  secret: Readonly<Record<string, string>>,
  path: string,
  key: "results" | "items",
  query: Record<string, string | number>,
  pages: number
): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pages; page++) {
    const res: { next_cursor?: string | null } & Partial<
      Record<"results" | "items", T[]>
    > = await http.json({
      url: `${API}${path}`,
      query: { ...query, limit: LIMIT, cursor },
      headers: todoistHeaders(secret),
    });
    rows.push(...(res[key] ?? []));
    cursor = res.next_cursor ?? null;
    if (!cursor) return { rows, complete: true };
  }
  return { rows, complete: false };
}

export function activeTasks(
  http: Http,
  secret: Readonly<Record<string, string>>,
  pages = 5
) {
  return paged<TodoistTask>(http, secret, "/tasks", "results", {}, pages);
}

/** Project id to name. */
export async function projectNames(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<Map<string, string>> {
  const { rows } = await paged<{ id: string; name: string }>(
    http,
    secret,
    "/projects",
    "results",
    {},
    3
  );
  return new Map(rows.map((p) => [p.id, p.name]));
}

/** Tasks completed from `since` (at most 3 months back) until `until`. */
export function completedTasks(
  http: Http,
  secret: Readonly<Record<string, string>>,
  since: Date,
  until: Date,
  pages = 2
) {
  return paged<TodoistTask>(
    http,
    secret,
    "/tasks/completed/by_completion_date",
    "items",
    { since: since.toISOString(), until: until.toISOString() },
    pages
  );
}
