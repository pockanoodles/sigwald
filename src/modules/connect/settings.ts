/**
 * A connector module's settings, checked against the fields it declares.
 * Pure, so the server (saving, pulling) and the browser (the form) agree.
 */
import type { SettingField, SettingValue, Settings } from "./spec";

/** Each field's value as stored, or its default where nothing valid is stored. */
export function resolveSettings(
  fields: readonly SettingField[],
  stored: unknown
): Settings {
  const raw = isRecord(stored) ? stored : {};
  const out: Settings = {};
  for (const field of fields) {
    const checked = checkValue(field, raw[field.key]);
    out[field.key] = "value" in checked ? checked.value : defaultOf(field);
  }
  return out;
}

/** The labels of required fields that are still empty: a pull waits until they're set. */
export function missingSettings(
  fields: readonly SettingField[],
  settings: Settings
): string[] {
  return fields.flatMap((field) => {
    if (field.kind !== "text" && field.kind !== "list") return [];
    if (field.optional) return [];
    const value = settings[field.key];
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    return empty ? [field.label] : [];
  });
}

/**
 * A settings change from the form, checked field by field. Fields it doesn't
 * name keep their stored value. Answers with what's wrong instead when any
 * value doesn't fit its field.
 */
export function applySettingsChange(
  fields: readonly SettingField[],
  stored: unknown,
  change: unknown
): { settings: Settings } | { problem: string } {
  if (!isRecord(change)) return { problem: "Send the settings as an object" };
  const settings = resolveSettings(fields, stored);
  for (const [key, value] of Object.entries(change)) {
    const field = fields.find((f) => f.key === key);
    if (!field) return { problem: `There's no setting called ${key}` };
    const checked = checkValue(field, value);
    if ("problem" in checked)
      return { problem: `${field.label}: ${checked.problem}` };
    settings[key] = checked.value;
  }
  return { settings };
}

function defaultOf(field: SettingField): SettingValue {
  switch (field.kind) {
    case "text":
      return field.default ?? "";
    case "list":
      return field.default ?? [];
    case "toggle":
    case "select":
    case "number":
      return field.default;
  }
}

/** Splits a list typed one per line (or comma-separated) into its values. */
export function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkValue(
  field: SettingField,
  value: unknown
): { value: SettingValue } | { problem: string } {
  switch (field.kind) {
    case "text": {
      if (value === undefined || value === null)
        return { value: field.default ?? "" };
      if (typeof value !== "string") return { problem: "must be text" };
      const text = value.trim();
      const max = field.maxLength ?? 500;
      if (text.length > max)
        return { problem: `keep it under ${max} characters` };
      if (
        text &&
        field.pattern &&
        !new RegExp(`^(?:${field.pattern.source})$`).test(text)
      ) {
        return { problem: field.pattern.message };
      }
      return { value: text };
    }
    case "list": {
      if (value === undefined || value === null)
        return { value: field.default ?? [] };
      const items = typeof value === "string" ? splitList(value) : value;
      if (!Array.isArray(items) || items.some((v) => typeof v !== "string")) {
        return { problem: "must be a list" };
      }
      const clean = [
        ...new Set((items as string[]).map((s) => s.trim()).filter(Boolean)),
      ];
      const max = field.maxItems ?? 50;
      if (clean.length > max) return { problem: `list at most ${max}` };
      if (clean.some((s) => s.length > 500))
        return { problem: "one of them is too long" };
      if (field.itemPattern) {
        const pattern = new RegExp(`^(?:${field.itemPattern.source})$`);
        const bad = clean.find((s) => !pattern.test(s));
        if (bad) return { problem: `${bad}: ${field.itemPattern.message}` };
      }
      return { value: clean };
    }
    case "toggle":
      if (value === undefined || value === null)
        return { value: field.default };
      return typeof value === "boolean"
        ? { value }
        : { problem: "must be on or off" };
    case "select": {
      if (value === undefined || value === null)
        return { value: field.default };
      return typeof value === "string" &&
        field.options.some((o) => o.value === value)
        ? { value }
        : { problem: "isn't one of the choices" };
    }
    case "number": {
      if (value === undefined || value === null || value === "")
        return { value: field.default };
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n))
        return { problem: "must be a number" };
      if (n < field.min || n > field.max) {
        return { problem: `must be from ${field.min} to ${field.max}` };
      }
      return { value: n };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Typed reads of a resolved setting, for pulls. */
export const setting = {
  text: (s: Settings, key: string): string => {
    const v = s[key];
    return typeof v === "string" ? v : "";
  },
  list: (s: Settings, key: string): string[] => {
    const v = s[key];
    return Array.isArray(v) ? [...v] : [];
  },
  on: (s: Settings, key: string): boolean => s[key] === true,
  number: (s: Settings, key: string, fallback = 0): number => {
    const v = s[key];
    return typeof v === "number" ? v : fallback;
  },
};
