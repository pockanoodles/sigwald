/**
 * Asana's REST API 1.0, read-only: who the token is (and its workspaces) and
 * the tasks assigned to you in one workspace. Every answer is wrapped in
 * `{ data }`, and lists page by `next_page.offset`.
 * Docs checked:
 * - https://developers.asana.com/reference/getuser (GET /users/me, users:read,
 *   workspaces come back only with opt_fields)
 * - https://developers.asana.com/reference/gettasks (assignee + workspace
 *   together, completed_since, limit up to 100, offset, opt_fields, tasks:read)
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://app.asana.com/api/1.0";
const PAGE = 100;

export function asanaHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `Bearer ${secret.token}`,
    Accept: "application/json",
  };
}

export const verifyAsana: VerifyFn = async ({ http, secret }) => {
  const res = await http.json<{
    data: {
      gid: string;
      name?: string;
      workspaces?: { gid: string; name?: string }[];
    };
  }>({
    url: `${API}/users/me`,
    query: { opt_fields: "name,workspaces.gid,workspaces.name" },
    headers: asanaHeaders(secret),
  });
  const me = res.data;
  const config: Record<string, string> = { userGid: me.gid };
  const first = me.workspaces?.[0];
  if (first) config.workspace = first.gid;
  return { label: me.name ?? me.gid, config };
};

export interface AsanaTask {
  gid: string;
  name: string;
  due_on?: string | null;
  due_at?: string | null;
  permalink_url?: string;
  completed?: boolean;
  completed_at?: string | null;
  modified_at?: string | null;
  projects?: { gid: string; name: string }[];
}

const TASK_FIELDS = [
  "name",
  "due_on",
  "due_at",
  "permalink_url",
  "completed",
  "completed_at",
  "modified_at",
  "projects.name",
].join(",");

interface TasksPage {
  data: AsanaTask[];
  next_page?: { offset?: string } | null;
}

/**
 * Tasks assigned to you in a workspace: every incomplete one, and those
 * completed since `completedSince` ("now" for none). `complete` is false when
 * there were more pages than were read.
 */
export async function assignedTasks(
  http: Http,
  secret: Readonly<Record<string, string>>,
  workspace: string,
  completedSince: string,
  pages = 5
): Promise<{ tasks: AsanaTask[]; complete: boolean }> {
  const tasks: AsanaTask[] = [];
  let offset: string | null = null;
  for (let n = 0; n < pages; n++) {
    const res: TasksPage = await http.json<TasksPage>({
      url: `${API}/tasks`,
      query: {
        assignee: "me",
        workspace,
        completed_since: completedSince,
        opt_fields: TASK_FIELDS,
        limit: PAGE,
        offset,
      },
      headers: asanaHeaders(secret),
    });
    tasks.push(...res.data);
    offset = res.next_page?.offset ?? null;
    if (!offset) return { tasks, complete: true };
  }
  return { tasks, complete: false };
}
