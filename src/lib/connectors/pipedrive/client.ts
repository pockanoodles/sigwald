/**
 * Pipedrive's API, reads only. The token goes in the `x-api-token` header,
 * never in the address. Activities and the names of what they belong to are
 * read through API v2 (cursor pagination, `ids` filter); the connection
 * check uses v1 `users/me`, which the v2 spec doesn't have.
 * Docs checked:
 *   https://developers.pipedrive.com/docs/api/v1/openapi-v2.yaml
 *     (GET /api/v2/activities: owner_id, done, ids up to 100, sort_by,
 *     limit up to 500, cursor and additional_data.next_cursor; due_date
 *     "YYYY-MM-DD", due_time "HH:MM:SS", duration "HH:MM:SS";
 *     GET /api/v2/deals, /persons, /organizations with `ids`)
 *   https://developers.pipedrive.com/docs/api/v1/openapi.yaml
 *     (GET /v1/users/me: id, name, company_domain)
 *   https://pipedrive.readme.io/docs/core-api-concepts-authentication
 *     (x-api-token header)
 *   https://pipedrive.readme.io/docs/pipedrive-api-v2-migration-guide
 *     (v2 dropped deal_title, person_name and org_name from activities)
 * Pipedrive documents no activity link, so tasks carry none.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const V1 = "https://api.pipedrive.com/v1";
const V2 = "https://api.pipedrive.com/api/v2";
const PAGE = 100;
/** Pages of 100 read for the open list before the answer is called partial. */
const MAX_PAGES = 3;

function headers(secret: Readonly<Record<string, string>>) {
  return { "x-api-token": secret.token };
}

export const verifyPipedrive: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{
    data: { id: number; name?: string; company_domain?: string };
  }>({ url: `${V1}/users/me`, headers: headers(secret) });
  return {
    label: me.data.name || "Pipedrive user",
    config: {
      userId: String(me.data.id),
      companyDomain: me.data.company_domain ?? "",
    },
  };
};

export interface PipedriveActivity {
  id: number;
  subject: string | null;
  type: string | null;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  due_date: string | null;
  due_time: string | null;
  duration: string | null;
  done: boolean;
  marked_as_done_time: string | null;
  update_time: string | null;
  note: string | null;
}

interface List<T> {
  data: T[] | null;
  additional_data?: { next_cursor?: string | null };
}

/** The activities owned by `userId` that aren't done, soonest due first. */
export async function undoneActivities(
  http: Http,
  secret: Readonly<Record<string, string>>,
  userId: string
): Promise<{ activities: PipedriveActivity[]; complete: boolean }> {
  const activities: PipedriveActivity[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer: List<PipedriveActivity> = await http.json({
      url: `${V2}/activities`,
      headers: headers(secret),
      query: {
        owner_id: userId,
        done: false,
        sort_by: "due_date",
        sort_direction: "asc",
        limit: PAGE,
        cursor,
      },
    });
    activities.push(...(answer.data ?? []));
    cursor = answer.additional_data?.next_cursor;
    if (!cursor) return { activities, complete: true };
  }
  return { activities, complete: false };
}

/** Which of these activity ids are marked done now (one read, up to 100 ids). */
export async function doneAmong(
  http: Http,
  secret: Readonly<Record<string, string>>,
  ids: readonly string[]
): Promise<PipedriveActivity[]> {
  if (ids.length === 0) return [];
  const answer: List<PipedriveActivity> = await http.json({
    url: `${V2}/activities`,
    headers: headers(secret),
    query: { ids: ids.slice(0, 100).join(","), done: true, limit: 100 },
  });
  return answer.data ?? [];
}

export type EntityKind = "deals" | "persons" | "organizations";

/** The display names of up to 100 deals, people or organizations, by id. */
export async function namesOf(
  http: Http,
  secret: Readonly<Record<string, string>>,
  kind: EntityKind,
  ids: readonly number[]
): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (ids.length === 0) return names;
  const answer: List<{ id: number; title?: string; name?: string }> =
    await http.json({
      url: `${V2}/${kind}`,
      headers: headers(secret),
      query: { ids: ids.slice(0, 100).join(","), limit: 100 },
    });
  for (const row of answer.data ?? []) {
    const name = kind === "deals" ? row.title : row.name;
    if (name) names.set(row.id, name);
  }
  return names;
}
