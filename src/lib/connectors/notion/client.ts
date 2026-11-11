/**
 * Notion's API, read-only, pinned to version 2022-06-28, where a database
 * still holds its property schema and is queried at one address. (Notion's
 * reference marks both calls deprecated from version 2025-09-03, which moves
 * them to data sources; the older version keeps answering.) The one POST
 * is the database query, which only reads.
 * Docs checked:
 * - https://developers.notion.com/reference/get-self (GET /v1/users/me, bot
 *   user with `name` and `bot.workspace_name`)
 * - https://developers.notion.com/reference/post-database-query (page_size,
 *   start_cursor, `results`, `next_cursor`, `has_more`)
 * - https://developers.notion.com/reference/page-property-values (title,
 *   date, status, select and checkbox values)
 */
import type { Http } from "@/lib/connectors/egress";
import { isConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

export function notionHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `Bearer ${secret.token}`,
    "Notion-Version": VERSION,
  };
}

export const verifyNotion: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{
    name?: string | null;
    bot?: { workspace_name?: string | null };
  }>({ url: `${API}/users/me`, headers: notionHeaders(secret) });
  const workspace = me.bot?.workspace_name;
  const name = me.name || "Notion integration";
  return { label: workspace ? `${name} (${workspace})` : name };
};

export interface NotionProperty {
  id: string;
  name: string;
  type: string;
}

export interface NotionDatabase {
  id: string;
  title: { plain_text: string }[];
  url?: string;
  properties: Record<string, NotionProperty>;
}

export interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties: Record<string, NotionValue>;
}

export interface NotionRich {
  plain_text: string;
}

export interface NotionValue {
  type: string;
  title?: NotionRich[];
  date?: {
    start: string;
    end?: string | null;
    time_zone?: string | null;
  } | null;
  status?: { name: string } | null;
  select?: { name: string } | null;
  checkbox?: boolean;
}

/** The database's schema, or null when the integration can't see it (not shared with it). */
export async function getDatabase(
  http: Http,
  secret: Readonly<Record<string, string>>,
  id: string
): Promise<NotionDatabase | null> {
  try {
    return await http.json<NotionDatabase>({
      url: `${API}/databases/${id}`,
      headers: notionHeaders(secret),
    });
  } catch (error) {
    if (isConnectorError(error) && error.kind === "not_found") return null;
    throw error;
  }
}

/** A database's rows, `pages` pages of 100 at most; `complete` is false when there were more. */
export async function queryRows(
  http: Http,
  secret: Readonly<Record<string, string>>,
  id: string,
  pages = 3
): Promise<{ rows: NotionPage[]; complete: boolean }> {
  const rows: NotionPage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < pages; page++) {
    const res = await http.json<{
      results: NotionPage[];
      next_cursor?: string | null;
      has_more?: boolean;
    }>({
      url: `${API}/databases/${id}/query`,
      method: "POST",
      headers: notionHeaders(secret),
      json: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    rows.push(...res.results);
    if (!res.has_more || !res.next_cursor) return { rows, complete: true };
    cursor = res.next_cursor;
  }
  return { rows, complete: false };
}
