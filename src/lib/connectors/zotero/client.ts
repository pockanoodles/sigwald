/**
 * Zotero's Web API v3, read-only. The key goes in `Zotero-API-Key` and every
 * request names `Zotero-API-Version: 3`.
 * Docs checked: https://www.zotero.org/support/dev/web_api/v3/basics (base
 * URL, the two headers, /users/<userID>/items/top, the collections form,
 * `tag`, `itemKey` up to 50, `limit` up to 100, `start`, the Link header
 * with rel="next", format=json with item fields in `data`).
 * Not in the docs: GET /keys/current. They list /keys/<key>, which would put
 * the key in the address. /keys/current answers 403 without a key where an
 * unknown path answers 404, so it is a real route, and it returns
 * { userID, username, access }. It is the one unconfirmed read here.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.zotero.org";
const LIMIT = 100;
const MAX_PAGES = 3;
/** The most item keys one request may name (the docs' limit). */
export const MAX_ITEM_KEYS = 50;

export function zoteroHeaders(secret: Readonly<Record<string, string>>) {
  return { "Zotero-API-Key": secret.key, "Zotero-API-Version": "3" };
}

export const verifyZotero: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{ userID: number | string; username?: string }>({
    url: `${API}/keys/current`,
    headers: zoteroHeaders(secret),
  });
  const username = me.username ?? "";
  return {
    label: username || `Library ${me.userID}`,
    config: { userID: String(me.userID), username },
  };
};

export interface ZoteroItem {
  key: string;
  links?: { alternate?: { href?: string } };
  meta?: { parsedDate?: string };
  data: {
    key: string;
    itemType?: string;
    title?: string;
    creators?: {
      firstName?: string;
      lastName?: string;
      name?: string;
      creatorType?: string;
    }[];
    date?: string;
    url?: string;
    DOI?: string;
    publicationTitle?: string;
    bookTitle?: string;
    websiteTitle?: string;
    proceedingsTitle?: string;
    tags?: { tag: string }[];
    collections?: string[];
    dateModified?: string;
  };
}

function nextLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>\s*;\s*rel="next"/);
  return match?.[1] ?? null;
}

/**
 * The top-level items in the library (or one collection) with a tag, newest
 * modified first, up to 3 pages of 100. `complete` is false when there were more.
 */
export async function listQueue(
  http: Http,
  secret: Readonly<Record<string, string>>,
  userID: string,
  where: { tag?: string; collection?: string }
): Promise<{ items: ZoteroItem[]; complete: boolean }> {
  const base = where.collection
    ? `${API}/users/${userID}/collections/${encodeURIComponent(where.collection)}/items/top`
    : `${API}/users/${userID}/items/top`;
  const items: ZoteroItem[] = [];
  let next: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await http.request(
      next
        ? { url: next, headers: zoteroHeaders(secret) }
        : {
            url: base,
            query: {
              format: "json",
              limit: LIMIT,
              sort: "dateModified",
              direction: "desc",
              tag: where.collection ? undefined : where.tag,
            },
            headers: zoteroHeaders(secret),
          }
    );
    items.push(...(JSON.parse(res.text) as ZoteroItem[]));
    next = nextLink(res.headers.get("link"));
    if (!next) return { items, complete: true };
  }
  return { items, complete: false };
}

/** The items with these keys, as they are now. A trashed or deleted one is not in the answer. */
export async function itemsByKey(
  http: Http,
  secret: Readonly<Record<string, string>>,
  userID: string,
  keys: readonly string[]
): Promise<ZoteroItem[]> {
  if (keys.length === 0) return [];
  return http.json<ZoteroItem[]>({
    url: `${API}/users/${userID}/items`,
    query: {
      itemKey: keys.slice(0, MAX_ITEM_KEYS).join(","),
      format: "json",
      limit: MAX_ITEM_KEYS,
    },
    headers: zoteroHeaders(secret),
  });
}
