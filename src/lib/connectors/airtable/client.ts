/**
 * Airtable's Web API, read-only. A personal access token goes in a Bearer
 * header.
 * Docs checked:
 * - https://airtable.com/developers/web/api/authentication (Bearer token;
 *   tokens are made at /create/tokens)
 * - https://airtable.com/developers/web/api/get-user-id-scopes (GET
 *   /v0/meta/whoami: `id`, and `email` only with the user.email:read scope)
 * - https://airtable.com/developers/web/api/list-records (GET
 *   /v0/{baseId}/{tableIdOrName}: pageSize up to 100, `offset`, `view`;
 *   `{ records: [{ id, createdTime, fields }], offset? }`, and empty or
 *   false fields are left out of a record)
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.airtable.com/v0";

export function airtableHeaders(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.token}` };
}

export const verifyAirtable: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{ id: string; email?: string }>({
    url: `${API}/meta/whoami`,
    headers: airtableHeaders(secret),
  });
  return { label: me.email ?? me.id };
};

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

/** A table's records, `pages` pages of 100 at most; `complete` is false when there were more. */
export async function listRecords(
  http: Http,
  secret: Readonly<Record<string, string>>,
  base: string,
  table: string,
  view: string,
  pages = 5
): Promise<{ records: AirtableRecord[]; complete: boolean }> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < pages; page++) {
    const res = await http.json<{
      records: AirtableRecord[];
      offset?: string;
    }>({
      url: `${API}/${encodeURIComponent(base)}/${encodeURIComponent(table)}`,
      query: { pageSize: 100, view: view || undefined, offset },
      headers: airtableHeaders(secret),
    });
    records.push(...res.records);
    if (!res.offset) return { records, complete: true };
    offset = res.offset;
  }
  return { records, complete: false };
}
