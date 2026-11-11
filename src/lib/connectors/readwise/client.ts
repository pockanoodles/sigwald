/**
 * Readwise Reader's API, read-only: `Authorization: Token <token>`, 20
 * requests a minute.
 * Docs checked: https://readwise.io/reader_api (the auth check at
 * /api/v2/auth/ answers 204; GET /api/v3/list/ with `location` of new,
 * later, shortlist, archive or feed, `updatedAfter`, `pageCursor`, `limit`
 * up to 100; results carry id, url, source_url, title, author, site_name,
 * category, word_count, reading_time as text like "4 mins", updated_at and
 * parent_id; the answer has `count` and `nextPageCursor`).
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://readwise.io/api";
const LIMIT = 100;

export function readwiseHeaders(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Token ${secret.token}` };
}

export const verifyReadwise: VerifyFn = async ({ http, secret }) => {
  // 204 No Content on success; anything else is an error the egress raises.
  await http.request({
    url: `${API}/v2/auth/`,
    headers: readwiseHeaders(secret),
  });
  return { label: "Readwise Reader" };
};

export interface ReaderDocument {
  id: string;
  url?: string;
  source_url?: string | null;
  title?: string | null;
  author?: string | null;
  site_name?: string | null;
  category?: string | null;
  location?: string | null;
  word_count?: number | null;
  reading_time?: string | number | null;
  updated_at?: string | null;
  parent_id?: string | null;
}

interface ListAnswer {
  count?: number;
  nextPageCursor?: string | null;
  results?: ReaderDocument[];
}

/**
 * Documents in one Reader location, optionally only those updated after a
 * time, up to `maxPages` of 100. `count` is Reader's own total for the
 * query; `complete` is false when pages remained.
 */
export async function listDocuments(
  http: Http,
  secret: Readonly<Record<string, string>>,
  location: "later" | "shortlist" | "archive",
  options: { updatedAfter?: Date; maxPages?: number } = {}
): Promise<{ documents: ReaderDocument[]; count: number; complete: boolean }> {
  const documents: ReaderDocument[] = [];
  let cursor: string | null = null;
  let count = 0;
  const maxPages = options.maxPages ?? 5;
  for (let page = 0; page < maxPages; page++) {
    const res: ListAnswer = await http.json<ListAnswer>({
      url: `${API}/v3/list/`,
      query: {
        location,
        limit: LIMIT,
        updatedAfter: options.updatedAfter?.toISOString(),
        pageCursor: cursor,
      },
      headers: readwiseHeaders(secret),
    });
    documents.push(...(res.results ?? []));
    if (page === 0) count = res.count ?? documents.length;
    cursor = res.nextPageCursor ?? null;
    if (!cursor) return { documents, count, complete: true };
  }
  return { documents, count, complete: false };
}
