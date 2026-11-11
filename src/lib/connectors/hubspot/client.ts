/**
 * HubSpot's CRM API, reads only, with a private app access token (Bearer).
 * The one POST is CRM search, which only reads.
 * Docs checked:
 *   https://developers.hubspot.com/docs/api-reference/search/guide
 *     (POST search: filterGroups, EQ/NEQ/IN, properties, sorts, limit up to
 *     200, paging.next.after, 10,000 result cap)
 *   https://developers.hubspot.com/docs/api-reference/crm-tasks-v3/guide
 *     (hs_task_priority LOW/MEDIUM/HIGH, hs_task_type EMAIL/CALL/TODO,
 *     hs_timestamp as ms epoch or UTC ISO)
 *   https://developers.hubspot.com/docs/api-reference/legacy/crm/owners/guide
 *     (GET /crm/v3/owners with `email`, scope crm.objects.owners.read)
 * HubSpot documents no task URL form, so tasks carry no link.
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.hubapi.com";
const PAGE = 100;
/** Pages of 100 read for the open list before the answer is called partial. */
const MAX_PAGES = 3;

export const TASK_PROPERTIES = [
  "hs_task_subject",
  "hs_timestamp",
  "hs_task_priority",
  "hs_task_status",
  "hs_task_type",
  "hs_task_body",
  "hs_task_completion_date",
  "hs_lastmodifieddate",
];

function headers(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.token}` };
}

interface Owner {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export const verifyHubspot: VerifyFn = async ({ http, secret, config }) => {
  const email = (config.email ?? "").trim();
  const list = await http.json<{ results: Owner[] }>({
    url: `${API}/crm/v3/owners`,
    query: { email, limit: 10 },
    headers: headers(secret),
  });
  const owner = list.results.find(
    (o) => (o.email ?? "").toLowerCase() === email.toLowerCase()
  );
  if (!owner) {
    throw new ConnectorError(
      "not_found",
      "HubSpot has no owner with that email"
    );
  }
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
  return {
    label: name || "HubSpot user",
    config: { ownerId: owner.id, ownerName: name },
  };
};

export interface HubspotTask {
  id: string;
  properties: Record<string, string | null | undefined>;
}

interface SearchAnswer {
  results: HubspotTask[];
  paging?: { next?: { after?: string } };
}

function search(
  http: Http,
  secret: Readonly<Record<string, string>>,
  body: Record<string, unknown>
): Promise<SearchAnswer> {
  return http.json<SearchAnswer>({
    url: `${API}/crm/v3/objects/tasks/search`,
    method: "POST",
    headers: headers(secret),
    json: { properties: TASK_PROPERTIES, limit: PAGE, ...body },
  });
}

/** Tasks owned by `ownerId` that aren't completed, soonest due first. */
export async function openTasks(
  http: Http,
  secret: Readonly<Record<string, string>>,
  ownerId: string
): Promise<{ tasks: HubspotTask[]; complete: boolean }> {
  const tasks: HubspotTask[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await search(http, secret, {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hubspot_owner_id",
              operator: "EQ",
              value: ownerId,
            },
            {
              propertyName: "hs_task_status",
              operator: "NEQ",
              value: "COMPLETED",
            },
          ],
        },
      ],
      sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
      ...(after ? { after } : {}),
    });
    tasks.push(...answer.results);
    after = answer.paging?.next?.after;
    if (!after) return { tasks, complete: true };
  }
  return { tasks, complete: false };
}

/** Which of `ids` are completed now (one search, at most 100 ids). */
export async function completedAmong(
  http: Http,
  secret: Readonly<Record<string, string>>,
  ids: readonly string[]
): Promise<HubspotTask[]> {
  if (ids.length === 0) return [];
  const answer = await search(http, secret, {
    filterGroups: [
      {
        filters: [
          { propertyName: "hs_object_id", operator: "IN", values: [...ids] },
          {
            propertyName: "hs_task_status",
            operator: "EQ",
            value: "COMPLETED",
          },
        ],
      },
    ],
  });
  return answer.results;
}
