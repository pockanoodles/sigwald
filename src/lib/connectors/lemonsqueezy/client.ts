/**
 * Lemon Squeezy's API, read-only, a JSON:API service with the key as a
 * Bearer token. Every request carries the JSON:API Accept and Content-Type
 * headers. Store revenue fields are cents in USD whatever the store's own
 * currency is; the sales fields are counts.
 * Docs checked:
 * - https://docs.lemonsqueezy.com/api/getting-started/requests (headers,
 *   page[number], page[size] up to 100)
 * - https://docs.lemonsqueezy.com/api/users/retrieve-user (GET /v1/users/me)
 * - https://docs.lemonsqueezy.com/api/stores (total_revenue,
 *   thirty_day_revenue in cents of USD; total_sales, thirty_day_sales)
 * - https://docs.lemonsqueezy.com/api/stores/list-all-stores (meta.page)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.lemonsqueezy.com/v1";
const MAX_PAGES = 5;

function headers(secret: Readonly<Record<string, string>>) {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${secret.key}`,
  };
}

export const verifyLemonSqueezy: VerifyFn = async ({ http, secret }) => {
  const res = await http.json<{
    data?: { attributes?: { name?: string; email?: string } };
  }>({ url: `${API}/users/me`, headers: headers(secret) });
  const user = res?.data?.attributes;
  if (!user)
    throw new ConnectorError(
      "bad_response",
      "Lemon Squeezy didn't say who you are"
    );
  return { label: user.name || user.email || "Lemon Squeezy" };
};

export interface LemonStore {
  id: string;
  attributes: {
    name?: string;
    currency?: string;
    /** Counts. */
    total_sales: number;
    thirty_day_sales: number;
    /** Cents of USD. */
    total_revenue: number;
    thirty_day_revenue: number;
  };
}

/** Every store the key reaches, up to MAX_PAGES pages of 100. */
export async function stores(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<{ data: LemonStore[]; complete: boolean }> {
  const data: LemonStore[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await http.json<{
      data?: LemonStore[];
      meta?: { page?: { currentPage?: number; lastPage?: number } };
    }>({
      url: `${API}/stores`,
      query: { "page[number]": page, "page[size]": 100 },
      headers: headers(secret),
    });
    if (!Array.isArray(res?.data))
      throw new ConnectorError(
        "bad_response",
        "Lemon Squeezy answered stores without a list"
      );
    data.push(...res.data);
    const last = res.meta?.page?.lastPage;
    if (typeof last !== "number" || page >= last)
      return { data, complete: typeof last === "number" };
  }
  return { data, complete: false };
}
