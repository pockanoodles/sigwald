/**
 * Unsplash's API, read-only, with an application's Access Key sent as
 * `Authorization: Client-ID <key>`.
 * Docs checked: https://unsplash.com/documentation (base URL, the
 * Client-ID header and Accept-Version: v1, GET /users/:username with its
 * `downloads` total, GET /users/:username/statistics with downloads and
 * views each holding `total` and `historical.values[{date, value}]`, 30
 * days by default; demo apps get 50 requests an hour).
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.unsplash.com";

export function unsplashHeaders(secret: Readonly<Record<string, string>>) {
  return {
    Authorization: `Client-ID ${secret.key}`,
    "Accept-Version": "v1",
  };
}

/** The username without a leading @. */
export function cleanUsername(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^@/, "");
}

interface UnsplashProfile {
  username: string;
  name?: string;
  downloads?: number | null;
}

export async function getProfile(
  http: Http,
  secret: Readonly<Record<string, string>>,
  username: string
): Promise<UnsplashProfile> {
  return http.json<UnsplashProfile>({
    url: `${API}/users/${encodeURIComponent(username)}`,
    headers: unsplashHeaders(secret),
  });
}

export const verifyUnsplash: VerifyFn = async ({ http, secret, config }) => {
  const username = cleanUsername(config.username);
  const profile = await getProfile(http, secret, username);
  return {
    label: profile.name || `@${profile.username}`,
    config: { username: profile.username },
  };
};

interface Series {
  total?: number;
  historical?: { values?: { date?: string; value?: number }[] };
}

export interface UnsplashStatistics {
  downloads?: Series;
  views?: Series;
}

export function getStatistics(
  http: Http,
  secret: Readonly<Record<string, string>>,
  username: string
): Promise<UnsplashStatistics> {
  return http.json<UnsplashStatistics>({
    url: `${API}/users/${encodeURIComponent(username)}/statistics`,
    query: { resolution: "days", quantity: 30 },
    headers: unsplashHeaders(secret),
  });
}
