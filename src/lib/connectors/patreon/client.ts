/**
 * Patreon's API v2, read-only, with a Creator's Access Token sent as a
 * Bearer token. Every attribute has to be asked for in a sparse fieldset,
 * `fields[campaign]=patron_count` (the brackets are URL-encoded on the wire).
 * Docs checked: https://docs.patreon.com/ (identity at
 * /api/oauth2/v2/identity with fields[user]=full_name, campaigns at
 * /api/oauth2/v2/campaigns, Campaign.patron_count, scopes identity and
 * campaigns). The docs list no paid-member count on a campaign, so there is
 * none here.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://www.patreon.com/api/oauth2/v2";

export function patreonHeaders(secret: Readonly<Record<string, string>>) {
  return { Authorization: `Bearer ${secret.token}` };
}

export const verifyPatreon: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{
    data: { id: string; attributes?: { full_name?: string } };
  }>({
    url: `${API}/identity`,
    query: { "fields[user]": "full_name" },
    headers: patreonHeaders(secret),
  });
  return { label: me.data.attributes?.full_name || "Patreon creator" };
};

export interface PatreonCampaign {
  id: string;
  attributes?: { patron_count?: number | null };
}

export async function listCampaigns(
  http: Http,
  secret: Readonly<Record<string, string>>
): Promise<PatreonCampaign[]> {
  const res = await http.json<{ data?: PatreonCampaign[] }>({
    url: `${API}/campaigns`,
    query: { "fields[campaign]": "patron_count" },
    headers: patreonHeaders(secret),
  });
  return res.data ?? [];
}
