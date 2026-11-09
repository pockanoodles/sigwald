import { Prisma } from "@prisma/client";

/**
 * Per-user account export classification.
 *
 * Every Prisma model is named here exactly once. Owner filters are the
 * security boundary: export, import empty-checks and erase all go through
 * them, so a future table that isn't listed fails the guard test instead of
 * quietly leaking or surviving an erase.
 */

export type OwnerFilter = (userId: string) => Record<string, unknown>;

export type ModelClass = "include" | "strip" | "exclude";

export type StripSpec = {
  class: "strip";
  fields: Record<string, unknown>;
  owner: OwnerFilter;
};

export type IncludeSpec = {
  class: "include";
  owner: OwnerFilter;
};

export type ExcludeSpec = {
  class: "exclude";
};

export type ModelSpec = IncludeSpec | StripSpec | ExcludeSpec;

const byUser: OwnerFilter = (userId) => ({ userId });

/** Credentials blanked on export; reconnect list is built from these rows. */
const CREDENTIAL_STRIP = {
  accessToken: "",
  refreshToken: null,
  expiresAt: new Date("1970-01-01T00:00:00.000Z"),
} as const;

/**
 * Hand-written owner filters. Nested paths follow the relation to User
 * (e.g. Shift → job.userId). CalendarEvent is restricted to LOCAL feeds —
 * provider events refill on sync.
 */
export const MODEL_SPECS: Record<string, ModelSpec> = {
  // include
  Project: { class: "include", owner: byUser },
  Task: { class: "include", owner: byUser },
  TaskProposal: { class: "include", owner: byUser },
  Tag: { class: "include", owner: byUser },
  GoalCycle: { class: "include", owner: byUser },
  Goal: { class: "include", owner: byUser },
  GoalLink: { class: "include", owner: (userId) => ({ parent: { userId } }) },
  TaskGoalLink: {
    class: "include",
    owner: (userId) => ({ task: { userId } }),
  },
  TaskInteraction: {
    class: "include",
    owner: (userId) => ({ task: { userId } }),
  },
  RankerState: { class: "include", owner: byUser },
  UserModule: { class: "include", owner: byUser },
  Person: { class: "include", owner: byUser },
  Interaction: {
    class: "include",
    owner: (userId) => ({ person: { userId } }),
  },
  Routine: { class: "include", owner: byUser },
  Workout: {
    class: "include",
    owner: (userId) => ({ routine: { userId } }),
  },
  WorkoutEntry: {
    class: "include",
    owner: (userId) => ({ workout: { routine: { userId } } }),
  },
  NutritionTarget: { class: "include", owner: byUser },
  Food: { class: "include", owner: byUser },
  FoodEntry: { class: "include", owner: byUser },
  Job: { class: "include", owner: byUser },
  Shift: { class: "include", owner: (userId) => ({ job: { userId } }) },
  JobContact: { class: "include", owner: (userId) => ({ job: { userId } }) },
  AutoScheduleSettings: { class: "include", owner: byUser },
  UserSettings: { class: "include", owner: byUser },
  CalendarSettings: { class: "include", owner: byUser },
  NotificationSettings: { class: "include", owner: byUser },
  IntegrationSettings: { class: "include", owner: byUser },
  DataSettings: { class: "include", owner: byUser },
  Course: { class: "include", owner: byUser },
  CourseModule: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  TaskMaterialLink: {
    class: "include",
    owner: (userId) => ({ task: { userId } }),
  },
  CourseAssignmentGroup: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  CourseAssignment: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  CourseAnnouncement: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  CourseConversation: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  CanvasCorrection: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  CourseActivity: {
    class: "include",
    owner: (userId) => ({ course: { userId } }),
  },
  CalendarFeed: { class: "include", owner: byUser },
  CalendarEvent: {
    class: "include",
    owner: (userId) => ({ feed: { userId, type: "LOCAL" } }),
  },
  TaskListMapping: {
    class: "include",
    owner: (userId) => ({ provider: { userId } }),
  },

  // strip
  ConnectedAccount: {
    class: "strip",
    fields: { ...CREDENTIAL_STRIP },
    owner: byUser,
  },
  TaskProvider: {
    class: "strip",
    fields: { ...CREDENTIAL_STRIP },
    owner: byUser,
  },
  CourseMaterial: {
    class: "strip",
    fields: { localPath: null, downloadError: null },
    owner: (userId) => ({ course: { userId } }),
  },

  // exclude
  User: { class: "exclude" },
  Account: { class: "exclude" },
  Session: { class: "exclude" },
  VerificationToken: { class: "exclude" },
  PasswordReset: { class: "exclude" },
  OAuthRequest: { class: "exclude" },
  CalendarSubscription: { class: "exclude" },
  TaskChange: { class: "exclude" },
  Log: { class: "exclude" },
  SystemSettings: { class: "exclude" },
};

/** Models whose defaults may already exist on an otherwise empty account. */
export const DEFAULT_MODELS = new Set([
  "AutoScheduleSettings",
  "UserSettings",
  "CalendarSettings",
  "NotificationSettings",
  "IntegrationSettings",
  "DataSettings",
  "UserModule",
]);

/** Self-relation scalar fields: null on insert, set in a second pass. */
export const SELF_RELATION_FIELDS: Record<string, string> = {
  Task: "parentTaskId",
  CalendarEvent: "masterEventId",
  CourseMaterial: "parentId",
};

export function exportedModels(): string[] {
  return Object.keys(MODEL_SPECS).filter((name) => {
    const spec = MODEL_SPECS[name];
    return spec.class === "include" || spec.class === "strip";
  });
}

export function ownerFilter(
  model: string,
  userId: string
): Record<string, unknown> {
  const spec = MODEL_SPECS[model];
  if (!spec || spec.class === "exclude") {
    throw new Error(`No owner filter for ${model}`);
  }
  return spec.owner(userId);
}

/** Prisma client delegate key for a model name (`Task` → `task`). */
export function delegateKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function dmmfModel(name: string) {
  return Prisma.dmmf.datamodel.models.find((m) => m.name === name);
}

export function scalarFieldNames(model: string): Set<string> {
  const entry = dmmfModel(model);
  if (!entry) return new Set();
  return new Set(
    entry.fields.filter((f) => f.kind === "scalar").map((f) => f.name)
  );
}

export function dateTimeFieldNames(model: string): Set<string> {
  const entry = dmmfModel(model);
  if (!entry) return new Set();
  return new Set(
    entry.fields
      .filter((f) => f.kind === "scalar" && f.type === "DateTime")
      .map((f) => f.name)
  );
}

export function optionalJsonFieldNames(model: string): Set<string> {
  const entry = dmmfModel(model);
  if (!entry) return new Set();
  return new Set(
    entry.fields
      .filter((f) => f.kind === "scalar" && f.type === "Json" && !f.isRequired)
      .map((f) => f.name)
  );
}

/**
 * Relation scalar → related model, for FK validation on import.
 * Excludes userId (rewritten to the caller).
 */
export function relationScalars(
  model: string
): { field: string; relatedModel: string }[] {
  const entry = dmmfModel(model);
  if (!entry) return [];
  const out: { field: string; relatedModel: string }[] = [];
  for (const field of entry.fields) {
    if (field.kind !== "object") continue;
    const from = field.relationFromFields ?? [];
    if (from.length === 0) continue;
    for (const scalar of from) {
      if (scalar === "userId") continue;
      out.push({ field: scalar, relatedModel: field.type });
    }
  }
  return out;
}

export function applyStrip(
  model: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  const spec = MODEL_SPECS[model];
  if (!spec || spec.class !== "strip") return row;
  return { ...row, ...spec.fields };
}
