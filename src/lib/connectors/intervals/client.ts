/**
 * Intervals.icu's API, reads only. Basic auth with the literal user name
 * `API_KEY` and the person's key as the password; every path starts with
 * /api/v1/athlete/{id}.
 * Docs checked:
 * - https://forum.intervals.icu/t/intervals-icu-integration-cookbook/80090
 *   (personal API key with basic auth, user name API_KEY; dates are local
 *   yyyy-MM-dd)
 * - https://intervals.icu/api/v1/docs/swagger-ui/index.html (GET
 *   /athlete/{id}; GET /athlete/{id}/events with oldest, newest, category;
 *   the Event schema's id, category, start_date_local, name, type,
 *   moving_time and paired_activity_id; GET /athlete/{id}/wellness/{date}
 *   with ctl and atl)
 * Intervals.icu pairs a planned workout with the activity done for it, and
 * says so on the event as `paired_activity_id`; that is what "done" means here.
 * Unsure: the swagger page lists the fields without describing them, so
 * moving_time as the planned duration in seconds comes from the field's name
 * and how the calendar shows it, and a day with no wellness record is
 * assumed to answer 404.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const ORIGIN = "https://intervals.icu/api/v1/athlete";

interface Auth {
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

function get<T>(
  http: Http,
  auth: Auth,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  const basic = Buffer.from(`API_KEY:${auth.secret.key}`).toString("base64");
  return http.json<T>({
    url: `${ORIGIN}/${encodeURIComponent(auth.config.athleteId)}${path}`,
    query,
    headers: { Authorization: `Basic ${basic}` },
  });
}

export const verifyIntervals: VerifyFn = async ({ http, secret, config }) => {
  const athlete = await get<{ id: string; name?: string }>(
    http,
    { secret, config },
    ""
  );
  return { label: athlete.name || String(athlete.id) };
};

export interface IntervalsEvent {
  id: number;
  category: string;
  name?: string | null;
  type?: string | null;
  description?: string | null;
  /** A local date-time with no offset: "2026-11-12T00:00:00". */
  start_date_local: string;
  /** Planned duration, seconds. */
  moving_time?: number | null;
  icu_training_load?: number | null;
  paired_activity_id?: string | number | null;
}

/** Calendar workouts from `oldest` to `newest` (local days). */
export function workouts(
  http: Http,
  auth: Auth,
  oldest: string,
  newest: string
): Promise<IntervalsEvent[]> {
  return get<IntervalsEvent[]>(http, auth, "/events", {
    oldest,
    newest,
    category: "WORKOUT",
  });
}

export interface IntervalsWellness {
  id: string;
  ctl?: number | null;
  atl?: number | null;
}

/** One day's wellness record, or null when there isn't one yet. */
export async function wellness(
  http: Http,
  auth: Auth,
  day: string
): Promise<IntervalsWellness | null> {
  try {
    return await get<IntervalsWellness>(http, auth, `/wellness/${day}`);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as { kind?: string }).kind === "not_found"
    ) {
      return null;
    }
    throw error;
  }
}
