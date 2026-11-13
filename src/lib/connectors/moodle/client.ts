/**
 * Moodle's web service API, read functions only, over the REST protocol.
 * Every call is one POST of a form (wstoken, wsfunction, moodlewsrestformat=json
 * and the function's own arguments) to {site}/webservice/rest/server.php, so
 * the key never sits in a URL. Moodle answers a failure with HTTP 200 and a
 * body of { exception, errorcode, message }; `invalidtoken` is a refused key.
 * Docs checked:
 * - https://moodledev.io/docs/apis/subsystems/external (web service layer;
 *   a function's parameters and return shape are defined in its externallib)
 * - https://docs.moodle.org/dev/Web_services (REST protocol: server.php with
 *   wstoken, wsfunction, moodlewsrestformat; POST is the normal method)
 * - https://github.com/moodle/moodle/blob/main/public/calendar/externallib.php
 *   (core_calendar_get_action_events_by_timesort: timesortfrom, timesortto,
 *   aftereventid, limitnum; the events carry id, name, timesort, modulename,
 *   instance, eventtype, course and action)
 * - https://github.com/moodle/moodle/blob/main/public/calendar/classes/external/event_exporter_base.php
 *   (the event's fields)
 * - core_webservice_get_site_info (userid, fullname, sitename) and
 *   mod_assign_get_submission_status (assignid; lastattempt.submission.status,
 *   or lastattempt.teamsubmission.status on a group assignment)
 *   are read from each site's own /admin/webservice/documentation.php, which
 *   is where Moodle publishes the exact shapes for its version.
 * An action event's `instance` is its course module's id, not the
 * assignment's (checked in Moodle's source, MOODLE_405_STABLE); the exporter
 * reads it as `$cm->get('id')`. A wrong id makes that read fail or answer
 * another assignment; the pull treats a failed check as "don't know".
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

interface Auth {
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

interface MoodleError {
  exception?: string;
  errorcode?: string;
  message?: string;
}

/** One web service function, called with a form body. */
export async function moodleCall<T>(
  http: Http,
  auth: Auth,
  fn: string,
  args: Record<string, string | number> = {}
): Promise<T> {
  const site = (auth.config.site ?? "").replace(/\/+$/, "");
  const form: Record<string, string> = {
    wstoken: auth.secret.token,
    wsfunction: fn,
    moodlewsrestformat: "json",
  };
  for (const [key, value] of Object.entries(args)) form[key] = String(value);
  const answer = await http.json<T & MoodleError>({
    url: `${site}/webservice/rest/server.php`,
    method: "POST",
    form,
  });
  if (answer && typeof answer === "object" && "exception" in answer) {
    const code = answer.errorcode ?? "";
    const message = `Moodle: ${answer.message ?? (code || "an error")}`.slice(
      0,
      200
    );
    if (code === "invalidtoken") {
      throw new ConnectorError("auth", "Moodle refused the key");
    }
    if (code === "accessexception" || code === "webservice_access_exception") {
      throw new ConnectorError("forbidden", message);
    }
    throw new ConnectorError("bad_response", message);
  }
  return answer;
}

export interface MoodleSiteInfo {
  userid: number;
  fullname: string;
  sitename: string;
}

export const verifyMoodle: VerifyFn = async ({ http, secret, config }) => {
  const info = await moodleCall<MoodleSiteInfo>(
    http,
    { secret, config },
    "core_webservice_get_site_info"
  );
  return {
    label: info.fullname || info.sitename,
    config: { userid: String(info.userid), sitename: info.sitename ?? "" },
  };
};

export interface MoodleEvent {
  id: number;
  name: string;
  timesort: number;
  modulename?: string | null;
  instance?: number | null;
  eventtype?: string;
  url?: string;
  course?: { id: number; shortname?: string; fullname?: string } | null;
  action?: { name?: string; url?: string; actionable?: boolean } | null;
}

export const EVENTS_PAGE = 50;

/**
 * Action events (things to do by a time) from `from` to `to`, in pages of
 * 50, up to `pages`. `complete` is false when there were more pages.
 */
export async function actionEvents(
  http: Http,
  auth: Auth,
  from: Date,
  to: Date,
  pages = 4
): Promise<{ events: MoodleEvent[]; complete: boolean }> {
  const events: MoodleEvent[] = [];
  let after = 0;
  for (let page = 0; page < pages; page++) {
    const answer = await moodleCall<{
      events: MoodleEvent[];
      lastid?: number | null;
    }>(http, auth, "core_calendar_get_action_events_by_timesort", {
      timesortfrom: Math.floor(from.getTime() / 1000),
      timesortto: Math.floor(to.getTime() / 1000),
      aftereventid: after,
      limitnum: EVENTS_PAGE,
    });
    const batch = answer.events ?? [];
    events.push(...batch);
    if (batch.length < EVENTS_PAGE) return { events, complete: true };
    const last = answer.lastid ?? batch[batch.length - 1]?.id;
    if (!last) return { events, complete: false };
    after = last;
  }
  return { events, complete: false };
}

interface MoodleSubmission {
  status?: string;
  timemodified?: number;
}

export interface MoodleSubmissionStatus {
  lastattempt?: {
    submission?: MoodleSubmission | null;
    /** The group's submission, on an assignment one teammate submits for all. */
    teamsubmission?: MoodleSubmission | null;
  } | null;
}

/**
 * A course module's activity: its module name and its own instance id. An
 * action event's `instance` is the course module's id (Moodle's
 * event_exporter_base sets it from `$cm->get('id')`), while
 * mod_assign_get_submission_status wants the assignment's id, so a check goes
 * through here first. core_course_get_course_module (cmid → cm.instance).
 */
export async function courseModule(
  http: Http,
  auth: Auth,
  cmid: number
): Promise<{ modname: string; instance: number } | null> {
  const answer = await moodleCall<{
    cm?: { modname?: string; instance?: number };
  }>(http, auth, "core_course_get_course_module", { cmid });
  const cm = answer.cm;
  return cm?.modname && typeof cm.instance === "number"
    ? { modname: cm.modname, instance: cm.instance }
    : null;
}

/** An assignment's status for the key's owner (mod_assign_get_submission_status). */
export function submissionStatus(
  http: Http,
  auth: Auth,
  assignId: number
): Promise<MoodleSubmissionStatus> {
  return moodleCall<MoodleSubmissionStatus>(
    http,
    auth,
    "mod_assign_get_submission_status",
    { assignid: assignId }
  );
}
