/**
 * Toggl Track API v9, read-only. Basic auth with `<api token>:api_token`.
 * Docs checked:
 * - https://engineering.toggl.com/docs/authentication/
 * - https://engineering.toggl.com/docs/api/me/ (GET /api/v9/me)
 * - https://engineering.toggl.com/docs/api/time_entries (GET
 *   /api/v9/me/time_entries with start_date and end_date, RFC 3339 or a
 *   date; at most 1000 entries; a running entry has a negative duration and
 *   a null stop)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.track.toggl.com/api/v9";
/** The list holds at most this many entries; a full one may be cut off. */
export const ENTRY_LIMIT = 1000;

function headers(secret: Readonly<Record<string, string>>) {
  const basic = Buffer.from(`${secret.token}:api_token`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

interface TogglMe {
  id: number;
  email?: string;
  fullname?: string;
}

export const verifyToggl: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<TogglMe>({
    url: `${API}/me`,
    headers: headers(secret),
  });
  if (typeof me?.id !== "number")
    throw new ConnectorError("bad_response", "Toggl didn't say who you are");
  return { label: me.fullname || me.email || "Toggl Track" };
};

export interface TogglEntry {
  id: number;
  start: string;
  stop: string | null;
  /** Seconds; negative while the timer runs. */
  duration: number;
}

/** Your entries that started between two instants. */
export function timeEntries(
  http: Http,
  secret: Readonly<Record<string, string>>,
  from: Date,
  to: Date
): Promise<TogglEntry[]> {
  return http.json<TogglEntry[]>({
    url: `${API}/me/time_entries`,
    query: { start_date: from.toISOString(), end_date: to.toISOString() },
    headers: headers(secret),
  });
}
