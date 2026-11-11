/**
 * The one way out for connector modules (server only). Every request a
 * module makes to an outside service goes through an `Http` made here for
 * that service, and nothing else under `src/lib/connectors` or
 * `src/modules` calls `fetch` (a test reads the source to keep it so). That
 * makes "what does Sigwald send, and where?" one question with one answer:
 * the services' manifests, checked here on every request.
 *
 * Each request is checked before it goes:
 *
 * - its host must be one the service names (`HostRule`); an address someone
 *   typed (a self-hosted site, a feed) must also resolve to a public address,
 *   never this machine or its network, and each redirect is checked again;
 * - GET always; POST only for a service that reads with it, and never a
 *   GraphQL mutation;
 * - it gives up after 20 seconds, stops reading past 8 MB, and one pull
 *   makes at most 60 requests.
 *
 * `SIGWALD_CONNECTORS=off` refuses every request, for an install that wants
 * no module talking to anything.
 */
import { assertPublicHost, assertResolvesPublic } from "@/lib/net/public-host";

import { ConnectorError } from "./errors";
import {
  type EgressPolicy,
  isGraphqlWrite,
  needsDnsCheck,
  refuseUrl,
} from "./policy";

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[];

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  /** Appended to the URL; null and undefined are left out, a list repeats the key. */
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** A JSON body (POST only). */
  json?: unknown;
  /** A form body (POST only). */
  form?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  /** Where the answer came from, after redirects. */
  url: string;
  headers: Headers;
  text: string;
}

export interface Http {
  /** The answer, or a `ConnectorError` for anything but a 2xx. */
  request(req: HttpRequest): Promise<HttpResponse>;
  json<T>(req: HttpRequest | string): Promise<T>;
  text(req: HttpRequest | string): Promise<string>;
  /** Requests made so far. */
  readonly count: number;
}

export interface HttpOptions {
  fetch?: typeof fetch;
  maxRequests?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** The DNS check for typed hosts; tests swap it. */
  checkPublic?: (url: URL) => Promise<void>;
}

const USER_AGENT = "Sigwald (+https://github.com/pockanoodles/sigwald)";
const MAX_REDIRECTS = 3;
export const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

async function checkPublicDefault(url: URL): Promise<void> {
  assertPublicHost(url);
  await assertResolvesPublic(url);
}

export function withQuery(
  raw: string,
  query?: Record<string, QueryValue>
): URL {
  const url = new URL(raw);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, String(v));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url;
}

const SECRET_NAME = /auth|token|key|secret|session|cookie|password/i;

/** Values that carry a secret (by header or query name), so an error never repeats one back. */
function secretsIn(
  headers: Record<string, string>,
  query?: Record<string, QueryValue>
): string[] {
  const values = [
    ...Object.entries(headers).filter(([name]) => SECRET_NAME.test(name)),
    ...Object.entries(query ?? {}).filter(
      ([name, v]) => SECRET_NAME.test(name) && typeof v === "string"
    ),
  ].map(([, v]) => String(v));
  return values
    .flatMap((v) => [v, ...v.split(/\s+/)])
    .filter((v) => v.length >= 8);
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

async function readCapped(
  response: Response,
  maxBytes: number,
  name: string
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ConnectorError(
      "refused",
      `${name}'s answer is too large to read`
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ConnectorError(
        "refused",
        `${name}'s answer is too large to read`
      );
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(raw);
  return Number.isNaN(at)
    ? undefined
    : Math.max(0, Math.round((at - Date.now()) / 1000));
}

function failure(
  name: string,
  status: number,
  headers: Headers,
  body: string,
  secrets: string[]
): ConnectorError {
  const excerpt = redact(body.replace(/\s+/g, " ").trim(), secrets).slice(
    0,
    160
  );
  const detail = excerpt ? `: ${excerpt}` : "";
  if (status === 401)
    return new ConnectorError(
      "auth",
      `${name} refused the credentials`,
      status
    );
  if (
    status === 429 ||
    (status === 403 &&
      (headers.get("x-ratelimit-remaining") === "0" ||
        headers.has("retry-after")))
  ) {
    return new ConnectorError(
      "rate_limited",
      `${name} asked to slow down`,
      status,
      retryAfterSeconds(headers)
    );
  }
  if (status === 403)
    return new ConnectorError("forbidden", `${name} refused${detail}`, status);
  if (status === 404)
    return new ConnectorError(
      "not_found",
      `${name} found nothing there${detail}`,
      status
    );
  if (status >= 500)
    return new ConnectorError("server", `${name} failed (${status})`, status);
  return new ConnectorError(
    "bad_response",
    `${name} answered ${status}${detail}`,
    status
  );
}

/** An `Http` that may reach only what `policy` allows. */
export function createHttp(
  policy: EgressPolicy,
  options: HttpOptions = {}
): Http {
  const fetchImpl = options.fetch ?? fetch;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const checkPublic = options.checkPublic ?? checkPublicDefault;
  let count = 0;

  async function vet(url: URL): Promise<void> {
    const refused = refuseUrl(policy, url);
    if (refused)
      throw new ConnectorError(
        "refused",
        `Sigwald won't send this: ${refused}`
      );
    if (needsDnsCheck(policy)) {
      try {
        await checkPublic(url);
      } catch (error) {
        throw new ConnectorError(
          "refused",
          `Sigwald won't send this: ${error instanceof Error ? error.message : "not a public address"}`
        );
      }
    }
  }

  async function request(req: HttpRequest): Promise<HttpResponse> {
    if (process.env.SIGWALD_CONNECTORS === "off") {
      throw new ConnectorError(
        "refused",
        "Modules may not reach outside services on this install (SIGWALD_CONNECTORS=off)"
      );
    }
    const method = req.method ?? "GET";
    if (method === "POST" && !policy.allowPost) {
      throw new ConnectorError(
        "refused",
        `Sigwald only reads from ${policy.name}, and never sends it a POST`
      );
    }
    if (method !== "GET" && method !== "POST") {
      throw new ConnectorError(
        "refused",
        `Sigwald only reads from ${policy.name}`
      );
    }
    if (method === "POST" && isGraphqlWrite(req.json)) {
      throw new ConnectorError(
        "refused",
        `Sigwald only reads from ${policy.name}, and never sends it a change`
      );
    }
    if (
      method === "GET" &&
      (req.json !== undefined || req.form !== undefined)
    ) {
      throw new ConnectorError("refused", "A read sends no body");
    }

    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...req.headers,
    };
    let body: string | undefined;
    if (req.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if (req.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(req.form).toString();
    }
    const secrets = secretsIn(req.headers ?? {}, req.query);

    let url = withQuery(req.url, req.query);
    const origin = url.host;
    for (let hop = 0; ; hop++) {
      if (count >= maxRequests) {
        throw new ConnectorError(
          "refused",
          `Stopped after ${maxRequests} requests to ${policy.name} in one pull`
        );
      }
      await vet(url);
      count += 1;

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers,
          body,
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ConnectorError(
          "network",
          timedOut
            ? `${policy.name} took too long to answer`
            : `Couldn't reach ${policy.name}`
        );
      }

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        await response.body?.cancel().catch(() => undefined);
        if (hop >= MAX_REDIRECTS) {
          throw new ConnectorError(
            "bad_response",
            `${policy.name} redirected too many times`
          );
        }
        const next = new URL(response.headers.get("location")!, url);
        // Credentials stay with the host they were made for: a redirect
        // elsewhere is followed only for a public source, which has none.
        if (next.host !== origin && policy.host.kind !== "public") {
          throw new ConnectorError(
            "refused",
            `${policy.name} redirected to ${next.hostname}, which Sigwald won't follow`
          );
        }
        url = next;
        continue;
      }

      const text = await readCapped(response, maxBytes, policy.name);
      if (response.status < 200 || response.status >= 300) {
        throw failure(
          policy.name,
          response.status,
          response.headers,
          text,
          secrets
        );
      }
      return {
        status: response.status,
        url: url.toString(),
        headers: response.headers,
        text,
      };
    }
  }

  const asRequest = (req: HttpRequest | string): HttpRequest =>
    typeof req === "string" ? { url: req } : req;

  return {
    request,
    async json<T>(req: HttpRequest | string): Promise<T> {
      const response = await request(asRequest(req));
      try {
        return JSON.parse(response.text) as T;
      } catch {
        throw new ConnectorError(
          "bad_response",
          `${policy.name} answered something that isn't JSON`
        );
      }
    },
    async text(req: HttpRequest | string): Promise<string> {
      const r = asRequest(req);
      const response = await request({
        ...r,
        headers: { Accept: "*/*", ...r.headers },
      });
      return response.text;
    },
    get count() {
      return count;
    },
  };
}
