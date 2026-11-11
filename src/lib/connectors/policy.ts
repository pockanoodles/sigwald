/**
 * The rules the egress checks before anything leaves: which hosts a service
 * may be reached at, over what, and with which methods. Pure, so the egress
 * and the tests share one copy.
 */
import type { HostRule, ServiceManifest } from "./types";

export interface EgressPolicy {
  /** Who the request is for, in messages ("GitHub"). */
  name: string;
  host: HostRule;
  /** The connection's own address, for a `site` rule. */
  site?: string | null;
  /** The service reads with POST (GraphQL, search): see `ServiceManifest.readsWithPost`. */
  allowPost: boolean;
}

/** What a service's manifest allows, with the connection's own address for a `site` rule. */
export function policyFor(
  service: ServiceManifest,
  config: Readonly<Record<string, string>>
): EgressPolicy {
  return {
    name: service.name,
    host: service.host,
    site:
      service.host.kind === "site"
        ? (config[service.host.field] ?? null)
        : null,
    allowPost: Boolean(service.readsWithPost),
  };
}

/** A policy that lets nothing out: for a module that works everything out on this machine. */
export const NOTHING_LEAVES: EgressPolicy = {
  name: "Sigwald",
  host: { kind: "fixed", hosts: [] },
  allowPost: false,
};

/** Whether `hostname` is one of `patterns` ("*.atlassian.net" is any host under it). */
export function hostMatches(
  hostname: string,
  patterns: readonly string[]
): boolean {
  const host = hostname.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p;
  });
}

/**
 * A typed site address made ready to keep: https only, no credentials in it,
 * no query or fragment, no trailing slash. A path stays (a WordPress under
 * /blog). Returns what's wrong instead when it can't be used.
 */
export function normalizeSite(
  raw: string,
  hosts?: readonly string[]
): { site: string } | { problem: string } {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
    );
  } catch {
    return { problem: "That isn't a web address." };
  }
  if (url.protocol !== "https:") {
    return { problem: "Use an https:// address." };
  }
  if (url.username || url.password) {
    return { problem: "Leave the username and password out of the address." };
  }
  if (hosts && !hostMatches(url.hostname, hosts)) {
    return { problem: `The address must be one of ${hosts.join(", ")}.` };
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { site: `${url.origin}${path}` };
}

/**
 * Why a request to `url` may not go under `policy`, or null when it may. The
 * DNS half of the check (a public name that resolves to a private address)
 * runs in the egress, since it needs the network.
 */
export function refuseUrl(policy: EgressPolicy, url: URL): string | null {
  const insecure = url.protocol !== "https:";
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `only web addresses can be read, not ${url.protocol}`;
  }
  if (url.username || url.password) {
    return "an address with a password in it";
  }
  const rule = policy.host;
  switch (rule.kind) {
    case "fixed":
      if (insecure) return `${policy.name} is only reached over https`;
      return hostMatches(url.hostname, rule.hosts)
        ? null
        : `${url.hostname} isn't one of ${policy.name}'s hosts`;
    case "site": {
      if (insecure) return `${policy.name} is only reached over https`;
      if (!policy.site) return `${policy.name} has no address set`;
      const site = new URL(policy.site);
      if (url.hostname.toLowerCase() !== site.hostname.toLowerCase()) {
        return `${url.hostname} isn't the ${policy.name} address you set`;
      }
      if (rule.hosts && !hostMatches(url.hostname, rule.hosts)) {
        return `${url.hostname} isn't one of ${policy.name}'s hosts`;
      }
      return null;
    }
    case "public":
      // Public feeds and sheets hold no secret, so plain http may be read.
      return null;
  }
}

/** Whether a request must also pass the DNS check (a host someone typed). */
export function needsDnsCheck(policy: EgressPolicy): boolean {
  return policy.host.kind !== "fixed";
}

/**
 * Whether a GraphQL body would change something. The egress sends POST only
 * to services that read with it, and refuses any body that names a mutation
 * or a subscription, so a read-only connector can't write even by mistake.
 */
export function isGraphqlWrite(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const query = (body as { query?: unknown }).query;
  if (typeof query !== "string") return false;
  const code = query.replace(/#[^\n]*/g, "");
  return /\b(mutation|subscription)\b\s*[A-Za-z_({]/.test(code);
}
