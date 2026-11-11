/**
 * Clockify's API v1, read-only, on the global server, with the key in
 * `X-Api-Key`. Workspaces on a regional or custom-domain server are not
 * reached: the host is fixed to api.clockify.me.
 * Docs checked:
 * - https://docs.clockify.me/ (Authentication; User: GET /v1/user answers id,
 *   name, email, activeWorkspace, defaultWorkspace)
 * - https://docs.clockify.me/ (Time entry: GET
 *   /v1/workspaces/{workspaceId}/user/{userId}/time-entries with start, end,
 *   page, page-size; timeInterval has start, end and an ISO 8601 duration,
 *   and end is null while the timer runs)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.clockify.me/api/v1";
const PAGE_SIZE = 500;
const MAX_PAGES = 4;

type Fields = Readonly<Record<string, string>>;

function headers(secret: Fields) {
  return { "X-Api-Key": secret.key };
}

interface ClockifyUser {
  id: string;
  name?: string;
  email?: string;
  activeWorkspace?: string;
  defaultWorkspace?: string;
}

export const verifyClockify: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<ClockifyUser>({
    url: `${API}/user`,
    headers: headers(secret),
  });
  const workspace = me?.activeWorkspace ?? me?.defaultWorkspace;
  if (!me?.id || !workspace)
    throw new ConnectorError(
      "bad_response",
      "Clockify didn't say who you are or which workspace is active"
    );
  return {
    label: me.name || me.email || "Clockify",
    config: { userId: me.id, workspaceId: workspace },
  };
};

export interface ClockifyEntry {
  id: string;
  timeInterval: { start: string; end: string | null; duration?: string | null };
}

/** Your entries that started between two instants, up to MAX_PAGES pages. */
export async function timeEntries(
  http: Http,
  secret: Fields,
  config: Fields,
  from: Date,
  to: Date
): Promise<{ data: ClockifyEntry[]; complete: boolean }> {
  if (!config.userId || !config.workspaceId)
    throw new ConnectorError(
      "config",
      "Reconnect Clockify so Sigwald can learn your workspace"
    );
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const data: ClockifyEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await http.json<ClockifyEntry[]>({
      url: `${API}/workspaces/${encodeURIComponent(config.workspaceId)}/user/${encodeURIComponent(config.userId)}/time-entries`,
      query: {
        start: iso(from),
        end: iso(to),
        page,
        "page-size": PAGE_SIZE,
      },
      headers: headers(secret),
    });
    if (!Array.isArray(list))
      throw new ConnectorError(
        "bad_response",
        "Clockify answered time entries without a list"
      );
    data.push(...list);
    if (list.length < PAGE_SIZE) return { data, complete: true };
  }
  return { data, complete: false };
}
