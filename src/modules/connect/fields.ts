/**
 * A connect form's values, checked against its service's fields before
 * anything is sent to the service: required ones there, patterns kept, a
 * typed address made safe to keep. Pure.
 */
import { normalizeSite } from "@/lib/connectors/policy";
import type { ServiceManifest } from "@/lib/connectors/types";

const MAX_FIELD_LENGTH = 4000;

function asStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
}

/** The connect form's values, checked against the service's fields: a secret and a config, or what's wrong. */
export function parseConnectFields(
  service: ServiceManifest,
  raw: unknown
):
  | { secret: Record<string, string>; config: Record<string, string> }
  | { problem: string } {
  const input = asStrings((raw as { fields?: unknown } | null)?.fields);
  const secret: Record<string, string> = {};
  const config: Record<string, string> = {};
  for (const field of service.fields) {
    const value = (input[field.key] ?? "").trim();
    if (!value) {
      if (field.optional) continue;
      return { problem: `${field.label} is needed` };
    }
    if (value.length > MAX_FIELD_LENGTH)
      return { problem: `${field.label} is too long` };
    let kept = value;
    if (
      field.pattern &&
      !new RegExp(`^(?:${field.pattern.source})$`).test(value)
    ) {
      return { problem: field.pattern.message };
    }
    if (field.kind === "url") {
      const hosts =
        service.host.kind === "site" && service.host.field === field.key
          ? service.host.hosts
          : undefined;
      const site = normalizeSite(value, hosts);
      if ("problem" in site)
        return { problem: `${field.label}: ${site.problem}` };
      kept = site.site;
    }
    if (field.kind === "secret") secret[field.key] = kept;
    else config[field.key] = kept;
  }
  return { secret, config };
}
