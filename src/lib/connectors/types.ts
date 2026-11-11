/**
 * What a connector is, as plain data: the outside service a module reads
 * through, the form that connects it, the hosts it may reach and what leaves
 * Sigwald for it. Safe in the browser: the catalog and the connect form read
 * these, and nothing here reaches Prisma or the network.
 *
 * Every call to the service itself lives beside its manifest
 * (`src/lib/connectors/<service>/client.ts`) and goes out through the one
 * egress (`src/lib/connectors/egress.ts`), which refuses any host the
 * manifest doesn't name.
 */
import type { ModuleEgress } from "@/modules/types";

import type { Http } from "./egress";

/** One field of a service's connect form. */
export interface ConnectField {
  /** Where its value is kept: in the encrypted secret for `secret`, in the plain config otherwise. */
  key: string;
  label: string;
  /** `secret` is stored encrypted and never sent back to the browser; `url` is an address. */
  kind: "secret" | "text" | "url";
  placeholder?: string;
  /** One short line under the field. */
  help?: string;
  /** May be left empty. */
  optional?: boolean;
  /** A pattern the whole value must match (a RegExp source), with what to say when it doesn't. */
  pattern?: { source: string; message: string };
}

/**
 * Where a service may be reached.
 *
 * - `fixed`: only these hosts. `*.example.com` allows any host under it, not
 *   the bare domain.
 * - `site`: the address the person types into the connection's `field` (a
 *   self-hosted GitLab, a Ghost site, a Jira site), and only that host. With
 *   `hosts`, the address must also be one of those (`*.atlassian.net`). A
 *   typed address is checked like an iCal link: never this machine or its
 *   network.
 * - `public`: any public address a module's settings name (an RSS feed, a
 *   published CSV), checked the same way. Such a service holds no secret.
 */
export type HostRule =
  | { kind: "fixed"; hosts: readonly string[] }
  | { kind: "site"; field: string; hosts?: readonly string[] }
  | { kind: "public" };

export interface ServiceManifest {
  /** Lowercase, stable: the `Connection.service` value. */
  id: string;
  /** Its own name for itself ("GitHub"). */
  name: string;
  /** Its home page, for the catalog. */
  homepage: string;
  /** How to make the token it needs, and where. Absent when it needs none. */
  tokenHelp?: { text: string; url: string };
  /** The connect form. Empty for a service that needs no account. */
  fields: readonly ConnectField[];
  host: HostRule;
  /**
   * Set when it reads with POST (a GraphQL API, a search endpoint): why that
   * is still only a read. Without it the egress allows GET alone.
   */
  readsWithPost?: string;
  /** What leaves Sigwald for it, in the words the catalog and DATAFLOW.md use. */
  egress: ModuleEgress;
}

/** What checking a connection learned: who it is, and anything a pull needs (an account id). */
export interface Verified {
  /** Who Sigwald reads as ("@octocat", "Kaito Soeno"). */
  label: string;
  /** Kept with the connection's fields; pulls read them from `config`. */
  config?: Record<string, string>;
}

/**
 * Checks a connection before it's saved, with one cheap read (who am I?).
 * Lives beside the service's client; `src/lib/connectors/verifiers.ts`
 * lists them.
 */
export type VerifyFn = (ctx: {
  http: Http;
  secret: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}) => Promise<Verified>;

/** Whether a service needs a connection before a module can read through it. */
export function needsAccount(service: ServiceManifest): boolean {
  return service.fields.length > 0;
}
