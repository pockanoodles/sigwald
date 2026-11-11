/**
 * Trello's REST API, read-only. The key and token go in the documented
 * Authorization header, never in the address.
 * Docs checked:
 * - https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/
 *   (`Authorization: OAuth oauth_consumer_key="…", oauth_token="…"`, scope read)
 * - https://developer.atlassian.com/cloud/trello/rest/api-group-members/
 *   (GET /1/members/{id} with id "me"; /members/{id}/cards takes a `filter`;
 *   /members/{id}/boards takes `filter` and `fields`)
 * - the OpenAPI file at https://dac-static.atlassian.com/cloud/trello/swagger.v3.json
 *   for those parameters' allowed values.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.trello.com/1";

export function trelloHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `OAuth oauth_consumer_key="${secret.key}", oauth_token="${secret.token}"`,
  };
}

export const verifyTrello: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{
    id: string;
    fullName?: string;
    username?: string;
  }>({ url: `${API}/members/me`, headers: trelloHeaders(secret) });
  const name = me.fullName || me.username || me.id;
  return {
    label: me.username && me.fullName ? `${name} (@${me.username})` : name,
  };
};

export interface TrelloCard {
  id: string;
  name: string;
  desc?: string | null;
  /** ISO moment. */
  due?: string | null;
  dueComplete?: boolean;
  url?: string | null;
  idBoard: string;
  dateLastActivity?: string | null;
  labels?: { name?: string; color?: string | null }[];
}

/** Every open card the member is on. Trello answers them all at once. */
export function myCards(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<TrelloCard[]> {
  return http.json<TrelloCard[]>({
    url: `${API}/members/me/cards`,
    query: { filter: "open" },
    headers: trelloHeaders(secret),
  });
}

/** Board id to name, for the boards the member belongs to that are open. */
export async function myBoards(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<Map<string, string>> {
  const boards = await http.json<{ id: string; name: string }[]>({
    url: `${API}/members/me/boards`,
    query: { filter: "open", fields: "name" },
    headers: trelloHeaders(secret),
  });
  return new Map(boards.map((b) => [b.id, b.name]));
}
