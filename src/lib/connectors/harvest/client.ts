/**
 * Harvest's API v2, read-only. Sent with a personal access token and the
 * account id (`Harvest-Account-Id`).
 * Docs checked:
 * - https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/
 * - https://help.getharvest.com/api-v2/users-api/users/users/ (GET /v2/users/me)
 * - https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/
 *   (from/to by spent_date, user_id, page/per_page, next_page)
 * - https://help.getharvest.com/api-v2/invoices-api/invoices/invoices/
 *   (state=open|paid|closed|draft; Administrators and Managers only)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.harvestapp.com/v2";
const MAX_PAGES = 5;

type Fields = Readonly<Record<string, string>>;

function headers(secret: Fields, config: Fields) {
  return {
    Authorization: `Bearer ${secret.token}`,
    "Harvest-Account-Id": config.accountId ?? "",
  };
}

interface HarvestUser {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export const verifyHarvest: VerifyFn = async ({ http, secret, config }) => {
  const me = await http.json<HarvestUser>({
    url: `${API}/users/me`,
    headers: headers(secret, config),
  });
  if (typeof me?.id !== "number")
    throw new ConnectorError("bad_response", "Harvest didn't say who you are");
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ");
  return {
    label: name || me.email || "Harvest",
    config: { userId: String(me.id) },
  };
};

export interface HarvestTimeEntry {
  id: number;
  spent_date: string;
  hours: number;
  billable: boolean;
  is_running?: boolean;
}

export interface HarvestInvoice {
  id: number;
  number: string | null;
  client: { id: number; name: string } | null;
  due_date: string | null;
  state: string;
  amount?: number;
  due_amount?: number;
  currency?: string;
  closed_at?: string | null;
  paid_at?: string | null;
}

async function pages<T>(
  http: Http,
  secret: Fields,
  config: Fields,
  path: string,
  key: string,
  query: Record<string, string | number>
): Promise<{ data: T[]; complete: boolean }> {
  const data: T[] = [];
  let page: number | null = 1;
  for (let i = 0; i < MAX_PAGES && page; i++) {
    const res: Record<string, unknown> = await http.json({
      url: `${API}${path}`,
      query: { ...query, page },
      headers: headers(secret, config),
    });
    const list = res?.[key];
    if (!Array.isArray(list))
      throw new ConnectorError(
        "bad_response",
        `Harvest answered ${path} without a list`
      );
    data.push(...(list as T[]));
    page = typeof res.next_page === "number" ? res.next_page : null;
  }
  return { data, complete: page === null };
}

/** Your time entries with a spent date from `from` to `to` (YYYY-MM-DD). */
export function timeEntries(
  http: Http,
  secret: Fields,
  config: Fields,
  from: string,
  to: string
) {
  return pages<HarvestTimeEntry>(
    http,
    secret,
    config,
    "/time_entries",
    "time_entries",
    { from, to, per_page: 2000, user_id: config.userId ?? "" }
  );
}

export function openInvoices(http: Http, secret: Fields, config: Fields) {
  return pages<HarvestInvoice>(http, secret, config, "/invoices", "invoices", {
    state: "open",
    per_page: 100,
  });
}

export function invoice(
  http: Http,
  secret: Fields,
  config: Fields,
  id: string
): Promise<HarvestInvoice> {
  return http.json<HarvestInvoice>({
    url: `${API}/invoices/${encodeURIComponent(id)}`,
    headers: headers(secret, config),
  });
}
