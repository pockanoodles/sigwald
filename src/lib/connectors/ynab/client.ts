/**
 * YNAB's API v1, read-only, with a personal access token as a Bearer token.
 * YNAB renamed budgets to plans in its API; the /plans paths are the
 * documented ones, so they are the ones used here. A plan id is "last-used",
 * "default" or the plan's UUID.
 * Docs checked:
 * - https://api.ynab.com/ (authentication, 200 requests an hour, milliunits)
 * - https://api.ynab.com/papi/open_api_spec.yaml (GET /user, GET
 *   /plans/{plan_id}/settings, GET /plans/{plan_id}/months/{month} with
 *   to_be_budgeted, age_of_money and categories, GET
 *   /plans/{plan_id}/transactions?type=unapproved)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.ynab.com/v1";

type Fields = Readonly<Record<string, string>>;

function headers(secret: Fields) {
  return { Authorization: `Bearer ${secret.token}` };
}

export const verifyYnab: VerifyFn = async ({ http, secret }) => {
  const res = await http.json<{ data?: { user?: { id?: string } } }>({
    url: `${API}/user`,
    headers: headers(secret),
  });
  if (!res?.data?.user?.id)
    throw new ConnectorError("bad_response", "YNAB didn't say who you are");
  return { label: "YNAB account" };
};

export interface YnabCategory {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  /** Milliunits. */
  balance: number;
}

export interface YnabMonth {
  /** Milliunits. */
  to_be_budgeted: number;
  age_of_money: number | null;
  categories: YnabCategory[];
}

export interface YnabTransaction {
  id: string;
  approved: boolean;
  deleted: boolean;
}

function plan(budget: string): string {
  return `${API}/plans/${encodeURIComponent(budget)}`;
}

/** The budget's ISO currency code, lowercase, or null when YNAB doesn't say. */
export async function currencyOf(
  http: Http,
  secret: Fields,
  budget: string
): Promise<string | null> {
  const res = await http.json<{
    data?: { settings?: { currency_format?: { iso_code?: string } | null } };
  }>({ url: `${plan(budget)}/settings`, headers: headers(secret) });
  return res?.data?.settings?.currency_format?.iso_code?.toLowerCase() ?? null;
}

/** One month of a budget, by its first day ("2026-11-01"). */
export async function month(
  http: Http,
  secret: Fields,
  budget: string,
  firstDay: string
): Promise<YnabMonth> {
  const res = await http.json<{ data?: { month?: YnabMonth } }>({
    url: `${plan(budget)}/months/${firstDay}`,
    headers: headers(secret),
  });
  const m = res?.data?.month;
  if (
    !m ||
    typeof m.to_be_budgeted !== "number" ||
    !Array.isArray(m.categories)
  )
    throw new ConnectorError("bad_response", "YNAB answered a month oddly");
  return m;
}

/** Transactions waiting for approval. The list isn't paged. */
export async function unapproved(
  http: Http,
  secret: Fields,
  budget: string
): Promise<YnabTransaction[]> {
  const res = await http.json<{
    data?: { transactions?: YnabTransaction[] };
  }>({
    url: `${plan(budget)}/transactions`,
    query: { type: "unapproved" },
    headers: headers(secret),
  });
  const list = res?.data?.transactions;
  if (!Array.isArray(list))
    throw new ConnectorError(
      "bad_response",
      "YNAB answered transactions without a list"
    );
  return list;
}
