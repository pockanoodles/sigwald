/**
 * Zendesk Support's API, reads only, on the site the person typed. Basic
 * auth with an API token: username `{email}/token`, password the token.
 * Docs checked:
 *   https://developer.zendesk.com/api-reference/introduction/security-and-auth/
 *     (API token as Basic `{email_address}/token:{api_token}`)
 *   https://developer.zendesk.com/api-reference/ticketing/ticket-management/search/
 *     (GET /api/v2/search with query, sort_by, sort_order; 100 per page,
 *     1,000 results at most, a page past that is a 422)
 *   https://support.zendesk.com/hc/en-us/articles/4408886879258-Zendesk-Support-search-reference
 *     (type:ticket, assignee:me, status<solved)
 *   https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 *     (ticket fields; due_at only on task tickets; GET /api/v2/tickets/show_many
 *     with up to 100 ids)
 *   https://developer.zendesk.com/api-reference/ticketing/users/users/
 *     (GET /api/v2/users/me: id, name, role)
 * Zendesk documents no solved-at time on a ticket, so a solved ticket is
 * dated by its last update.
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const PER_PAGE = 100;
/** Pages of 100 read for the open list before the answer is called partial. */
const MAX_PAGES = 3;

function base(config: Readonly<Record<string, string>>): string {
  return (config.site ?? "").replace(/\/+$/, "");
}

function headers(
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>
) {
  const login = `${(config.email ?? "").trim()}/token:${secret.token}`;
  return {
    Authorization: `Basic ${Buffer.from(login).toString("base64")}`,
  };
}

export const verifyZendesk: VerifyFn = async ({ http, secret, config }) => {
  const me = await http.json<{
    user: { id: number; name?: string; role?: string };
  }>({
    url: `${base(config)}/api/v2/users/me`,
    headers: headers(secret, config),
  });
  if (me.user.role !== "agent" && me.user.role !== "admin") {
    throw new ConnectorError(
      "forbidden",
      "That login is not a Zendesk agent, so it has no tickets assigned"
    );
  }
  return {
    label: me.user.name || "Zendesk agent",
    config: { userId: String(me.user.id) },
  };
};

export interface ZendeskTicket {
  id: number;
  subject?: string | null;
  priority?: string | null;
  status: string;
  type?: string | null;
  due_at?: string | null;
  updated_at?: string | null;
}

/** Tickets assigned to the login that aren't solved yet, newest activity first. */
export async function assignedOpen(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>
): Promise<{ tickets: ZendeskTicket[]; complete: boolean }> {
  const tickets: ZendeskTicket[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const answer: { results: ZendeskTicket[]; next_page?: string | null } =
      await http.json({
        url: `${base(config)}/api/v2/search`,
        headers: headers(secret, config),
        query: {
          query: "type:ticket assignee:me status<solved",
          sort_by: "updated_at",
          sort_order: "desc",
          per_page: PER_PAGE,
          page,
        },
      });
    tickets.push(...answer.results);
    if (!answer.next_page) return { tickets, complete: true };
  }
  return { tickets, complete: false };
}

/** The tickets with these ids (up to 100), as they are now. */
export async function ticketsById(
  http: Http,
  secret: Readonly<Record<string, string>>,
  config: Readonly<Record<string, string>>,
  ids: readonly string[]
): Promise<ZendeskTicket[]> {
  if (ids.length === 0) return [];
  const answer = await http.json<{ tickets: ZendeskTicket[] }>({
    url: `${base(config)}/api/v2/tickets/show_many`,
    headers: headers(secret, config),
    query: { ids: ids.slice(0, 100).join(",") },
  });
  return answer.tickets;
}

/** Where a ticket opens in the agent workspace. */
export function ticketUrl(
  config: Readonly<Record<string, string>>,
  id: number
): string {
  return `${base(config)}/agent/tickets/${id}`;
}
