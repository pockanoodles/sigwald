/**
 * Figma's REST API, read-only. A personal access token goes in the
 * X-Figma-Token header.
 * Docs checked:
 * - https://developers.figma.com/docs/rest-api/personal-access-tokens/ (the header)
 * - https://developers.figma.com/docs/rest-api/users-endpoints/ and users-types/
 *   (GET /v1/me, scope current_user:read; id and handle)
 * - https://developers.figma.com/docs/rest-api/file-endpoints/ (GET /v1/files/:key/meta,
 *   scope file_metadata:read, the name at file.name)
 * - https://developers.figma.com/docs/rest-api/comments-endpoints/ and comments-types/
 *   (GET /v1/files/:key/comments, scope file_comments:read; id, parent_id, user,
 *   created_at, resolved_at). The message text is `message` in Figma's answers,
 *   though the types page doesn't list it.
 */
import type { Http } from "@/lib/connectors/egress";
import type { VerifyFn } from "@/lib/connectors/types";

const API = "https://api.figma.com/v1";

const headers = (secret: Readonly<Record<string, string>>) => ({
  "X-Figma-Token": secret.token,
});

export const verifyFigma: VerifyFn = async ({ http, secret }) => {
  const me = await http.json<{ id: string; handle: string }>({
    url: `${API}/me`,
    headers: headers(secret),
  });
  return {
    label: me.handle,
    config: { userId: me.id, handle: me.handle },
  };
};

/** A file key from a Figma address (/file/, /design/, /board/ and so on) or a bare key; null when it's neither. */
export function fileKey(input: string): string | null {
  const text = input.trim();
  const match =
    /figma\.com\/(?:file|design|board|proto|slides)\/([A-Za-z0-9]+)/.exec(text);
  if (match) return match[1];
  return /^[A-Za-z0-9]{10,}$/.test(text) ? text : null;
}

export interface FigmaComment {
  id: string;
  parent_id?: string | null;
  user: { id: string; handle: string };
  created_at: string;
  resolved_at?: string | null;
  message: string;
}

export async function fileName(
  http: Http,
  secret: Readonly<Record<string, string>>,
  key: string
): Promise<string> {
  const meta = await http.json<{ file: { name: string } }>({
    url: `${API}/files/${key}/meta`,
    headers: headers(secret),
  });
  return meta.file.name;
}

export async function fileComments(
  http: Http,
  secret: Readonly<Record<string, string>>,
  key: string
): Promise<FigmaComment[]> {
  const answer = await http.json<{ comments: FigmaComment[] }>({
    url: `${API}/files/${key}/comments`,
    headers: headers(secret),
  });
  return answer.comments;
}
