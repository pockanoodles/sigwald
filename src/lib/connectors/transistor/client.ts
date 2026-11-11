/**
 * Transistor's API (JSON:API), read-only. Key in the `x-api-key` header,
 * limit 10 requests per 10 seconds.
 * Docs checked: https://developers.transistor.fm/ (authenticated user at
 * GET /v1, shows, episodes with show_id and status filters, pagination[page]
 * and pagination[per] with meta.currentPage/totalPages, and
 * GET /v1/analytics/:id with dd-mm-yyyy start_date and end_date).
 * Times arrive as "2026-11-12 16:00:00 UTC".
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.transistor.fm/v1";
const PER = 50;

export function transistorHeaders(secret: Readonly<Record<string, string>>) {
  return { "x-api-key": secret.key };
}

interface Resource<A, R = unknown> {
  id: string;
  type: string;
  attributes: A;
  relationships?: R;
}

interface Page<T> {
  data: T[];
  meta?: { currentPage?: number; totalPages?: number; totalCount?: number };
}

export type TransistorShow = Resource<{
  title?: string;
  slug?: string;
}>;

export type TransistorEpisode = Resource<
  {
    title?: string;
    status?: "draft" | "scheduled" | "published" | string;
    published_at?: string | null;
    share_url?: string | null;
    summary?: string | null;
    duration?: number | null;
  },
  { show?: { data?: { id: string } | null } }
>;

export const verifyTransistor: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{ data: Resource<{ name?: string }> }>({
    url: API,
    headers: transistorHeaders(secret),
  });
  return { label: me.data.attributes.name || "Transistor account" };
};

/** "2026-11-12 16:00:00 UTC" (or an ISO time) as a Date, or null. */
export function transistorTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = value.replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/,
    "$1T$2Z"
  );
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Every item of a list, up to `maxPages` of 50. The first request leaves the
 * page out (the docs' default) and the next ones ask for the page after the
 * one meta says it sent.
 */
async function listPages<T>(
  http: Http,
  secret: Readonly<Record<string, string>>,
  path: string,
  query: Record<string, string | number>,
  maxPages: number
): Promise<{ data: T[]; complete: boolean }> {
  const data: T[] = [];
  let page: number | null = null;
  for (let n = 0; n < maxPages; n++) {
    const res: Page<T> = await http.json<Page<T>>({
      url: `${API}${path}`,
      query: {
        ...query,
        "pagination[per]": PER,
        "pagination[page]": page,
      },
      headers: transistorHeaders(secret),
    });
    data.push(...res.data);
    const total = res.meta?.totalPages ?? 0;
    // A short page, or as many pages read as the answer says there are, is the end.
    if (res.data.length < PER || (total > 0 && n + 1 >= total)) {
      return { data, complete: true };
    }
    page = (res.meta?.currentPage ?? n) + 1;
  }
  return { data, complete: false };
}

export function listShows(
  http: Http,
  secret: Readonly<Record<string, string>>
) {
  return listPages<TransistorShow>(http, secret, "/shows", {}, 2);
}

export function listEpisodes(
  http: Http,
  secret: Readonly<Record<string, string>>,
  status: "draft" | "scheduled",
  showId?: string
) {
  return listPages<TransistorEpisode>(
    http,
    secret,
    "/episodes",
    { status, ...(showId ? { show_id: showId } : {}) },
    3
  );
}

export async function getEpisode(
  http: Http,
  secret: Readonly<Record<string, string>>,
  id: string
): Promise<TransistorEpisode | null> {
  const res = await http.json<{ data?: TransistorEpisode }>({
    url: `${API}/episodes/${encodeURIComponent(id)}`,
    headers: transistorHeaders(secret),
  });
  return res.data ?? null;
}

/** A show's downloads for a span, as the sum of its daily counts. Dates are dd-mm-yyyy. */
export async function showDownloads(
  http: Http,
  secret: Readonly<Record<string, string>>,
  showId: string,
  start: string,
  end: string
): Promise<number> {
  const res = await http.json<{
    data: { attributes: { downloads?: { downloads?: number }[] } };
  }>({
    url: `${API}/analytics/${encodeURIComponent(showId)}`,
    query: { start_date: start, end_date: end },
    headers: transistorHeaders(secret),
  });
  return (res.data.attributes.downloads ?? []).reduce(
    (sum, day) => sum + (day.downloads ?? 0),
    0
  );
}
