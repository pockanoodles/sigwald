import { Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret } from "./secret-box";

/**
 * Encrypts credential columns on the way into Postgres and decrypts them on
 * the way out, as a Prisma client extension.
 *
 * Deliberately transparent rather than a pair of helpers called at each site.
 * Sigwald is a fork that periodically ports fixes from upstream, and the files
 * that touch tokens — the sync providers, the token manager, the OAuth
 * callbacks — are exactly the files those ports land in. Sprinkling
 * `encryptSecret()` through them would turn every future port into a merge
 * conflict. This way the divergence from upstream is two new files plus a
 * wrapper, and every existing call site reads `account.accessToken` and gets
 * a usable token, exactly as before.
 *
 * The trade-off is that these columns can no longer be searched by value.
 * Nothing does — verified before writing this: no `where` clause anywhere
 * filters on a credential — and it is inherent to encrypting with a random IV
 * rather than a property of this implementation.
 *
 * Transformation is model-aware and follows relations to any depth, because
 * most callers read a credential through an `include` rather than directly.
 * See `relationsFor` below for why that matters.
 */

/**
 * `Account` is intentionally absent: nothing writes it. Sessions are JWTs and
 * there is no NextAuth database adapter, so its `access_token` /
 * `refresh_token` columns stay empty — the live integration tokens live in
 * `ConnectedAccount` and `TaskProvider` below.
 *
 * `User.passwordHash` is absent for a different reason: it is a bcrypt hash,
 * which needs no encryption, and encrypting it would break `compare()`.
 */
const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  ConnectedAccount: ["accessToken", "refreshToken"],
  TaskProvider: ["accessToken", "refreshToken"],
  SystemSettings: ["googleClientSecret", "outlookClientSecret"],
  // Connector modules: the token or key each service was connected with, as JSON.
  Connection: ["secret"],
};

/**
 * Relation field -> related model, per model, from Prisma's own datamodel.
 *
 * This is what makes the extension work at depth. A credential is very often
 * read through a relation rather than directly:
 *
 *   prisma.calendarFeed.findUnique({ ..., include: { account: true } })
 *
 * Here the operation's model is `CalendarFeed`, which owns no credentials, so
 * a model-name-only check sees nothing to do and hands back a *ciphertext*
 * `account.accessToken` — which then gets sent to the provider as the
 * password. Fifteen call sites read credentials this way, and CalDAV failed
 * exactly like that: 401, the error swallowed by a `catch` that returns an
 * empty event list, and a sync that reported success after having already
 * deleted the feed's events.
 *
 * Deriving the map from `Prisma.dmmf` rather than hand-listing relations means
 * a new relation to a credential-bearing model is covered the day it is added.
 *
 * Built on first use, not at import. This module reaches the client bundle —
 * the extension is attached where the Prisma singleton is created, and that
 * module is pulled in transitively by client code — and `@prisma/client`
 * resolves to a browser stub there whose `Prisma.dmmf` is `undefined` while
 * `Prisma.defineExtension` still exists. Reading `.datamodel` at module scope
 * therefore threw during hydration and took down every page with
 * "a client-side exception has occurred". Nothing in the browser ever calls a
 * query, so deferring the read costs nothing and keeps the import inert.
 */
let relationsCache: Record<string, Record<string, string>> | null = null;

function relationsFor(model: string): Record<string, string> {
  if (!relationsCache) {
    const map: Record<string, Record<string, string>> = {};
    for (const entry of Prisma.dmmf.datamodel.models) {
      const relations: Record<string, string> = {};
      for (const field of entry.fields) {
        if (field.kind === "object") {
          relations[field.name] = field.type;
        }
      }
      map[entry.name] = relations;
    }
    relationsCache = map;
  }
  return relationsCache[model] ?? {};
}

/** Operations whose `args` carry field values that need encrypting. */
const WRITE_DATA_KEYS: Record<string, readonly string[]> = {
  create: ["data"],
  createMany: ["data"],
  createManyAndReturn: ["data"],
  update: ["data"],
  updateMany: ["data"],
  upsert: ["create", "update"],
};

/**
 * Prisma accepts both `field: value` and `field: { set: value }` on update.
 * Both have to be handled, and anything else (`increment`, a raw expression)
 * is left alone — it would not be a credential.
 */
function mapFieldValue(
  value: unknown,
  transform: (input: string) => string
): unknown {
  if (typeof value === "string") return transform(value);
  if (
    value &&
    typeof value === "object" &&
    "set" in value &&
    typeof (value as { set: unknown }).set === "string"
  ) {
    return { set: transform((value as { set: string }).set) };
  }
  return value;
}

/**
 * Walks a record for `model`, transforming that model's credential fields and
 * then recursing into whichever relations are actually present.
 *
 * Only relations present in the value are followed, so an ordinary query with
 * no `include` costs one pass over the record's own field names.
 */
function transformRecord(
  model: string,
  record: unknown,
  transform: (input: string) => string
): unknown {
  if (!record || typeof record !== "object") return record;
  if (Array.isArray(record)) {
    let arrayChanged = false;
    const mapped = record.map((entry) => {
      const next = transformRecord(model, entry, transform);
      if (next !== entry) arrayChanged = true;
      return next;
    });
    return arrayChanged ? mapped : record;
  }

  const source = record as Record<string, unknown>;
  const fields = ENCRYPTED_FIELDS[model] ?? [];
  const relations = relationsFor(model);
  let changed = false;
  const result: Record<string, unknown> = { ...source };

  for (const field of fields) {
    if (!(field in source)) continue;
    const next = mapFieldValue(source[field], transform);
    if (next !== source[field]) {
      result[field] = next;
      changed = true;
    }
  }

  for (const [relation, relatedModel] of Object.entries(relations)) {
    if (!(relation in source)) continue;
    const next = transformRecord(relatedModel, source[relation], transform);
    if (next !== source[relation]) {
      result[relation] = next;
      changed = true;
    }
  }

  return changed ? result : record;
}

/**
 * A nested write names the relation, then the operation, then the record:
 *
 *   { account: { create: { accessToken: "..." } } }
 *
 * Each of these keys can hold one record or an array of them, and a few wrap
 * the record one level deeper in `data`. Keys that only reference existing
 * rows (`connect`, `disconnect`, `set`, `delete`) carry no field values and
 * are skipped.
 */
function transformNestedWrite(
  model: string,
  operation: string,
  payload: unknown
): unknown {
  switch (operation) {
    case "create":
    case "update":
      // `update` is either bare fields or `{ where, data }`.
      if (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        "data" in (payload as Record<string, unknown>)
      ) {
        return transformWriteKeys(model, payload, ["data"]);
      }
      return transformWriteRecord(model, payload);
    case "updateMany":
      return Array.isArray(payload)
        ? payload.map((entry) => transformWriteKeys(model, entry, ["data"]))
        : transformWriteKeys(model, payload, ["data"]);
    case "createMany":
      return transformWriteKeys(model, payload, ["data"]);
    case "upsert":
      return Array.isArray(payload)
        ? payload.map((entry) =>
            transformWriteKeys(model, entry, ["create", "update"])
          )
        : transformWriteKeys(model, payload, ["create", "update"]);
    case "connectOrCreate":
      return Array.isArray(payload)
        ? payload.map((entry) => transformWriteKeys(model, entry, ["create"]))
        : transformWriteKeys(model, payload, ["create"]);
    default:
      return payload;
  }
}

/** Applies `transformWriteRecord` to named sub-keys of a wrapper object. */
function transformWriteKeys(
  model: string,
  wrapper: unknown,
  keys: readonly string[]
): unknown {
  if (!wrapper || typeof wrapper !== "object" || Array.isArray(wrapper)) {
    return wrapper;
  }

  const source = wrapper as Record<string, unknown>;
  let changed = false;
  const result: Record<string, unknown> = { ...source };

  for (const key of keys) {
    if (!(key in source)) continue;
    const next = transformWriteRecord(model, source[key]);
    if (next !== source[key]) {
      result[key] = next;
      changed = true;
    }
  }

  return changed ? result : wrapper;
}

/**
 * Encrypts the credential fields in a write payload for `model`, following
 * nested writes into related models.
 */
function transformWriteRecord(model: string, record: unknown): unknown {
  if (!record || typeof record !== "object") return record;
  if (Array.isArray(record)) {
    let arrayChanged = false;
    const mapped = record.map((entry) => {
      const next = transformWriteRecord(model, entry);
      if (next !== entry) arrayChanged = true;
      return next;
    });
    return arrayChanged ? mapped : record;
  }

  const source = record as Record<string, unknown>;
  const fields = ENCRYPTED_FIELDS[model] ?? [];
  const relations = relationsFor(model);
  let changed = false;
  const result: Record<string, unknown> = { ...source };

  for (const field of fields) {
    if (!(field in source)) continue;
    const next = mapFieldValue(source[field], encryptSecret);
    if (next !== source[field]) {
      result[field] = next;
      changed = true;
    }
  }

  for (const [relation, relatedModel] of Object.entries(relations)) {
    if (!(relation in source)) continue;
    const nested = source[relation];
    if (!nested || typeof nested !== "object") continue;

    let relationChanged = false;
    const patched: Record<string, unknown> = {
      ...(nested as Record<string, unknown>),
    };

    for (const [operation, payload] of Object.entries(
      nested as Record<string, unknown>
    )) {
      const next = transformNestedWrite(relatedModel, operation, payload);
      if (next !== payload) {
        patched[operation] = next;
        relationChanged = true;
      }
    }

    if (relationChanged) {
      result[relation] = patched;
      changed = true;
    }
  }

  return changed ? result : record;
}

export function encryptArgsForModel(model: string, args: unknown): unknown {
  return transformWriteRecord(model, args);
}

/**
 * Results come back in several shapes: one record, an array of them, `null`
 * from a `findUnique` that missed, or `{ count }` from a bulk write. Only the
 * first two carry field values, and `transformRecord` no-ops on the rest.
 */
export function decryptResultForModel(model: string, result: unknown): unknown {
  if (result === null || result === undefined) return result;
  if (typeof result !== "object") return result;
  return transformRecord(model, result, decryptSecret);
}

export const credentialEncryption = Prisma.defineExtension({
  name: "credential-encryption",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // No early return on the model name: a model that owns no credentials
        // can still carry one in an included relation, and skipping those was
        // the bug this replaced.
        const dataKeys = WRITE_DATA_KEYS[operation];
        let nextArgs = args;

        if (dataKeys && args && typeof args === "object") {
          const source = args as Record<string, unknown>;
          const patched: Record<string, unknown> = { ...source };
          let changed = false;

          for (const dataKey of dataKeys) {
            if (!(dataKey in source)) continue;
            const encrypted = encryptArgsForModel(model, source[dataKey]);
            if (encrypted !== source[dataKey]) {
              patched[dataKey] = encrypted;
              changed = true;
            }
          }

          if (changed) nextArgs = patched as typeof args;
        }

        return decryptResultForModel(model, await query(nextArgs));
      },
    },
  },
});
