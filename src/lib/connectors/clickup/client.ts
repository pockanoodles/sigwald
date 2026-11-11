/**
 * ClickUp's API v2, read-only: who the token is, its workspaces, and the
 * filtered team tasks. A personal token goes in the Authorization header as
 * it is, without "Bearer".
 * Docs checked:
 * - https://developer.clickup.com/docs/authentication
 * - https://developer.clickup.com/reference/getauthorizedteams
 * - https://developer.clickup.com/reference/getfilteredteamtasks
 * (assignees[], include_closed, date_updated_gt in epoch ms, page from 0,
 * up to 100 tasks a page). The docs don't list `due_date_time` on a task.
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.clickup.com/api/v2";
export const PAGE_SIZE = 100;

export function clickupHeaders(secret: Readonly<Record<string, string>>) {
  return { Authorization: secret.token };
}

export const verifyClickup: VerifyFn = async ({ http, secret }) => {
  const headers = clickupHeaders(secret);
  const me = await http.json<{
    user: { id: number; username?: string; email?: string };
  }>({ url: `${API}/user`, headers });
  const teams = await http.json<{ teams: { id: string; name: string }[] }>({
    url: `${API}/team`,
    headers,
  });
  const team = teams.teams[0];
  if (!team) {
    throw new ConnectorError("config", "That token has no ClickUp workspace");
  }
  const who = me.user.username ?? me.user.email ?? String(me.user.id);
  return {
    label: `${who} (${team.name})`,
    config: { userId: String(me.user.id), teamId: String(team.id) },
  };
};

export interface ClickupTask {
  id: string;
  name: string;
  text_content?: string | null;
  description?: string | null;
  status?: { status?: string; type?: string } | null;
  priority?: { id?: string; priority?: string } | null;
  /** Epoch milliseconds, as a string. */
  due_date?: string | null;
  due_date_time?: boolean | null;
  date_updated?: string | null;
  date_closed?: string | null;
  date_done?: string | null;
  url?: string | null;
  list?: { id: string; name?: string } | null;
  folder?: { name?: string } | null;
  tags?: { name: string }[];
}

/**
 * The workspace's tasks assigned to one person, `pages` pages of 100 at most.
 * With `closedSince` (epoch ms) it asks for closed ones updated since then
 * too. `complete` is false when there were more pages than were read.
 */
export async function assignedTasks(
  http: Http,
  secret: Readonly<Record<string, string>>,
  teamId: string,
  userId: string,
  opts: { closedSince?: number; pages?: number } = {}
): Promise<{ tasks: ClickupTask[]; complete: boolean }> {
  const tasks: ClickupTask[] = [];
  const pages = opts.pages ?? 5;
  for (let page = 0; page < pages; page++) {
    const res = await http.json<{ tasks: ClickupTask[]; last_page?: boolean }>({
      url: `${API}/team/${encodeURIComponent(teamId)}/task`,
      query: {
        "assignees[]": [userId],
        subtasks: true,
        include_closed: opts.closedSince !== undefined ? true : undefined,
        date_updated_gt: opts.closedSince,
        order_by: "updated",
        page,
      },
      headers: clickupHeaders(secret),
    });
    tasks.push(...res.tasks);
    if (res.last_page === true || res.tasks.length < PAGE_SIZE) {
      return { tasks, complete: true };
    }
  }
  return { tasks, complete: false };
}
