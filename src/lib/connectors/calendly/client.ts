/**
 * Calendly's API v2, reads only, with a personal access token (Bearer).
 * Docs checked:
 *   https://developer.calendly.com/openapi/calendly-api.yaml
 *     (GET /users/me, scope users:read; GET /scheduled_events with user,
 *     status active|canceled, min_start_time, max_start_time in UTC, sort,
 *     count up to 100, page_token and pagination.next_page_token, scope
 *     scheduled_events:read; an event's `name` is its event type's name;
 *     GET /scheduled_events/{uuid}/invitees)
 *   https://developer.calendly.com/api-docs/e2f95ebd44914-list-events
 * An invitee's email is never read into anything Sigwald keeps: only the
 * name is taken from the answer.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.calendly.com";
const PAGE = 100;
const MAX_PAGES = 2;

function headers(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.token}` };
}

export const verifyCalendly: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{ resource: { uri: string; name?: string } }>({
    url: `${API}/users/me`,
    headers: headers(secret),
  });
  return {
    label: me.resource.name || "Calendly user",
    config: { userUri: me.resource.uri },
  };
};

export interface CalendlyEvent {
  uri: string;
  name: string | null;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  updated_at?: string;
  /** How many have booked it: the cue a group event's invitees changed. */
  invitees_counter?: { active?: number } | null;
  location?: {
    type?: string;
    location?: string | null;
    join_url?: string | null;
  } | null;
}

/** The last path segment of a Calendly uri: its uuid. */
export function uuidOf(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

/** The user's events with this status that start inside the window. */
export async function eventsIn(
  http: Http,
  secret: Readonly<Record<string, string>>,
  userUri: string,
  status: "active" | "canceled",
  from: Date,
  to: Date
): Promise<{ events: CalendlyEvent[]; complete: boolean }> {
  const events: CalendlyEvent[] = [];
  let pageToken: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer: {
      collection: CalendlyEvent[];
      pagination?: { next_page_token?: string | null };
    } = await http.json({
      url: `${API}/scheduled_events`,
      headers: headers(secret),
      query: {
        user: userUri,
        status,
        min_start_time: from.toISOString(),
        max_start_time: to.toISOString(),
        sort: "start_time:asc",
        count: PAGE,
        page_token: pageToken,
      },
    });
    events.push(...answer.collection);
    pageToken = answer.pagination?.next_page_token;
    if (!pageToken) return { events, complete: true };
  }
  return { events, complete: false };
}

/** Who booked an event, by name only (never their email). */
export async function inviteeNames(
  http: Http,
  secret: Readonly<Record<string, string>>,
  eventUri: string
): Promise<string[]> {
  const answer = await http.json<{ collection: { name?: string | null }[] }>({
    url: `${API}/scheduled_events/${uuidOf(eventUri)}/invitees`,
    headers: headers(secret),
    query: { status: "active", count: 10 },
  });
  return answer.collection
    .map((i) => i.name?.trim() ?? "")
    .filter((n) => n.length > 0);
}
