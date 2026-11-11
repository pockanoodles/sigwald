/**
 * What a connector module declares about itself, as plain data on its
 * manifest (`ModuleManifest.connect`): the service it reads through, what it
 * makes, how often it reads and the settings it asks for. Safe in the
 * browser: the marketplace and the connect pane draw from it.
 *
 * The rest of a connector module is one function, its pull
 * (`src/modules/connect/pull.ts`), and the framework does everything else:
 * keeping the connection, running the pull when it's due, and turning what
 * the pull saw into tasks, calendar events and readings.
 */
import type { ServiceManifest } from "@/lib/connectors/types";

/** What a connector module puts into Sigwald. */
export type ConnectMakes = "tasks" | "events" | "readings";

interface FieldBase {
  key: string;
  label: string;
  /** One short line under it. */
  help?: string;
}

/** One of a module's own settings, beside the connection's fields. */
export type SettingField =
  | (FieldBase & {
      kind: "text";
      placeholder?: string;
      default?: string;
      /** May be left empty; a required one blocks pulls until it's set. */
      optional?: boolean;
      pattern?: { source: string; message: string };
      maxLength?: number;
    })
  | (FieldBase & {
      /** One value per line (repos to leave out, feed addresses). */
      kind: "list";
      placeholder?: string;
      default?: readonly string[];
      optional?: boolean;
      itemPattern?: { source: string; message: string };
      maxItems?: number;
    })
  | (FieldBase & { kind: "toggle"; default: boolean })
  | (FieldBase & {
      kind: "select";
      options: readonly { value: string; label: string }[];
      default: string;
    })
  | (FieldBase & {
      kind: "number";
      min: number;
      max: number;
      step?: number;
      default: number;
      /** Said after the number ("days"). */
      unit?: string;
    });

export type SettingValue = string | readonly string[] | boolean | number;
export type Settings = Record<string, SettingValue>;

export interface ConnectSpec {
  /**
   * The service it reads through. Null for a module that reaches nothing
   * outside: it works its answer out on this machine (Golden hour), or
   * things are sent to it (Inbox).
   */
  service: ServiceManifest | null;
  makes: readonly ConnectMakes[];
  /** Minutes between pulls. 0 for a module that never pulls. */
  everyMinutes: number;
  settings: readonly SettingField[];
  /** The most open tasks it keeps at once; the rest wait their turn. Defaults to 30. */
  maxOpen?: number;
  /** What its tasks are filed under. Defaults to WORK. */
  taskCategory?: "WORK" | "PERSONAL";
  /**
   * Its events that are over leave the calendar once a pull stops listing
   * them, instead of staying as history (Golden hour's past days).
   */
  forgetPastEvents?: boolean;
  /** The reading the top bar shows when it's asked to (`STATUS_FIELD`); its first reading otherwise. */
  headline?: string;
  /** Things are sent to it (at a private address) rather than read by a pull. */
  receives?: boolean;
}

export const DEFAULT_MAX_OPEN = 30;

/**
 * The setting every task-making module offers: how many of its tasks may be
 * open at once, so 300 Jira tickets don't bury Today. Modules list it with
 * their other settings so its default can be their own.
 */
export function maxOpenField(defaultValue = DEFAULT_MAX_OPEN): SettingField {
  return {
    kind: "number",
    key: "maxOpen",
    label: "Most open at once",
    help: "Past this, the rest wait until one is done.",
    min: 1,
    max: 200,
    default: defaultValue,
    unit: "tasks",
  };
}

/**
 * The setting a reading-making module offers: show its first reading in the
 * top bar's status strip, on every page.
 */
export const STATUS_FIELD: SettingField = {
  kind: "toggle",
  key: "status",
  label: "Show in the top bar",
  help: "Its first number sits in the status strip on every page.",
  default: false,
};
