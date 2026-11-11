/**
 * An `Http` for tests that answers from recorded routes, through the real
 * egress, so each connector's tests also prove it stays inside its
 * service's declared hosts and methods. Not a test file itself.
 */
import { type Http, createHttp } from "@/lib/connectors/egress";
import { type EgressPolicy, policyFor } from "@/lib/connectors/policy";
import type { ServiceManifest } from "@/lib/connectors/types";

export interface Route {
  method?: "GET" | "POST";
  /** Matched against the full URL: a prefix string, or a pattern. */
  url: string | RegExp;
  /** Matched against the request body, when given. */
  body?: RegExp;
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export function fakeHttp(
  policy: EgressPolicy,
  routes: readonly Route[]
): { http: Http; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : null;
    calls.push({
      method,
      url: input,
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    });
    const route = routes.find(
      (r) =>
        (r.method ?? "GET") === method &&
        (typeof r.url === "string"
          ? input.startsWith(r.url)
          : r.url.test(input)) &&
        (!r.body || (body !== null && r.body.test(body)))
    );
    if (!route) throw new Error(`No route for ${method} ${input}`);
    const text = route.text ?? JSON.stringify(route.json ?? null);
    return new Response(text, {
      status: route.status ?? 200,
      headers: route.headers ?? { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const http = createHttp(policy, {
    fetch: fetchImpl,
    checkPublic: async () => {},
  });
  return { http, calls };
}

/** `fakeHttp` for a service, with its connection's config. */
export function fakeServiceHttp(
  service: ServiceManifest,
  routes: readonly Route[],
  config: Record<string, string> = {}
): { http: Http; calls: Call[] } {
  return fakeHttp(policyFor(service, config), routes);
}
