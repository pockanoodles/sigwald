/**
 * Cal.com's API v2, reads only, with an API key (Bearer). Bookings are read
 * with the `cal-api-version: 2026-05-01` header the docs require; the
 * response is cursor-paginated (`pagination.nextCursor`, `hasMore`).
 * Docs checked:
 *   https://cal.com/docs/api-reference/v2/bookings/get-all-bookings
 *     (status upcoming|cancelled|..., one at a time; afterStart, beforeEnd,
 *     sortStart, limit up to 100, cursor; booking uid, title, start, end,
 *     status, location, meetingUrl, attendees)
 *   https://cal.com/docs/api-reference/v2/openapi.json
 *     (GET /v2/me: data.id, name, username, email, timeZone)
 *   https://cal.com/docs/api-reference/v2/me/get-my-profile
 * Attendees' emails are in the answer; only their names are read out.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.cal.com/v2";
export const BOOKINGS_VERSION = "2026-05-01";
const PAGE = 100;
const MAX_PAGES = 2;

function auth(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.token}` };
}

export const verifyCalcom: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{
    data: { id: number; name?: string | null; username?: string | null };
  }>({ url: `${API}/me`, headers: auth(secret) });
  return {
    label: me.data.name || me.data.username || "Cal.com user",
    config: { userId: String(me.data.id) },
  };
};

export interface CalcomBooking {
  uid: string;
  title?: string | null;
  status: string;
  start: string;
  end: string;
  location?: string | null;
  meetingUrl?: string | null;
  updatedAt?: string | null;
  attendees?: { name?: string | null }[];
}

/** Your bookings with this status that start between `from` and `to`. */
export async function bookingsIn(
  http: Http,
  secret: Readonly<Record<string, string>>,
  status: "upcoming" | "cancelled",
  from: Date,
  to: Date
): Promise<{ bookings: CalcomBooking[]; complete: boolean }> {
  const bookings: CalcomBooking[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer: {
      data: CalcomBooking[];
      pagination?: { nextCursor?: string | null; hasMore?: boolean };
    } = await http.json({
      url: `${API}/bookings`,
      headers: { ...auth(secret), "cal-api-version": BOOKINGS_VERSION },
      query: {
        status,
        afterStart: from.toISOString(),
        beforeEnd: to.toISOString(),
        sortStart: "asc",
        limit: PAGE,
        cursor,
      },
    });
    bookings.push(...answer.data);
    cursor = answer.pagination?.nextCursor;
    if (!answer.pagination?.hasMore || !cursor) {
      return { bookings, complete: true };
    }
  }
  return { bookings, complete: false };
}
