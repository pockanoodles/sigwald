/**
 * Stripe's API, read-only, with a restricted key. Pinned to one API version
 * so a change to the account's default can't change these shapes.
 * Docs: https://docs.stripe.com/api/balance, /api/disputes,
 * /api/subscriptions, /api/balance_transactions
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.stripe.com/v1";
const VERSION = "2024-06-20";
/** Pages of 100 read per list; past that the reading is said to be partial. */
const MAX_PAGES = 10;

function headers(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.key}`, "Stripe-Version": VERSION };
}

/** Currencies Stripe counts in whole units, and the ones it counts in thousandths. */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

/** An amount in Stripe's smallest unit as whole units (cents to dollars). */
export function fromMinor(amount: number, currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return amount;
  return amount / (THREE_DECIMAL.has(c) ? 1000 : 100);
}

export interface StripeBalance {
  livemode: boolean;
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export const verifyStripe: VerifyFn = async ({ http, secret }) => {
  const balance = await http.json<StripeBalance>({
    url: `${API}/balance`,
    headers: headers(secret),
  });
  return { label: balance.livemode ? "Live account" : "Test account" };
};

export function balance(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<StripeBalance> {
  return http.json<StripeBalance>({
    url: `${API}/balance`,
    headers: headers(secret),
  });
}

interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

/** Every page of a list, up to MAX_PAGES; `complete` is false past that. */
export async function listAll<T extends { id: string }>(
  http: Http,
  secret: Readonly<Record<string, string>>,
  path: string,
  query: Record<string, string | number | readonly string[]> = {}
): Promise<{ data: T[]; complete: boolean }> {
  const data: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: StripeList<T> = await http.json({
      url: `${API}${path}`,
      query: { limit: 100, ...query, starting_after: startingAfter },
      headers: headers(secret),
    });
    if (!Array.isArray(res?.data))
      throw new ConnectorError(
        "bad_response",
        `Stripe answered ${path} without a list`
      );
    data.push(...res.data);
    if (!res.has_more || res.data.length === 0) return { data, complete: true };
    startingAfter = res.data[res.data.length - 1].id;
  }
  return { data, complete: false };
}

export interface StripeDispute {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  charge: string | null;
  livemode: boolean;
  created: number;
  evidence_details: { due_by: number | null; submission_count: number } | null;
}

export interface StripeSubscription {
  id: string;
  items: {
    data: {
      id: string;
      quantity: number | null;
      price: {
        currency: string;
        unit_amount: number | null;
        recurring: {
          interval: "day" | "week" | "month" | "year";
          interval_count: number;
        } | null;
      };
    }[];
  };
}

export interface StripeBalanceTransaction {
  id: string;
  amount: number;
  currency: string;
  type: string;
}
