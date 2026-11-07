import { Prisma } from "@prisma/client";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import { logger } from "@/lib/logger";
import { type DbTransaction, prisma } from "@/lib/prisma";

import {
  DEFAULT_MODELS,
  MODEL_SPECS,
  SELF_RELATION_FIELDS,
  dateTimeFieldNames,
  delegateKey,
  exportedModels,
  optionalJsonFieldNames,
  ownerFilter,
  relationScalars,
  scalarFieldNames,
} from "./models";
import { latestMigrationName } from "./schema-version";
import { upgradeRow } from "./upgrade";

const LOG_SOURCE = "account-import";
const BATCH_SIZE = 500;
const MAX_BYTES = 200 * 1024 * 1024;
// The upload limit is on the compressed file; this bounds what it may expand
// to, since every line is held in memory until the transaction runs. A real
// account is tens of MB uncompressed.
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const TX_TIMEOUT_MS = 10 * 60 * 1000;

export type ImportHeader = {
  format: string;
  formatVersion: number;
  schema: string;
  app?: string;
  exportedAt?: string;
  counts?: Record<string, number>;
};

export type ReconnectItem =
  | { kind: "account"; provider: string; email: string }
  | { kind: "provider"; type: string; name: string };

export type ImportResult = {
  counts: Record<string, number>;
  reconnect: ReconnectItem[];
};

export class ImportHttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Import failed");
    this.status = status;
    this.body = body;
  }
}

type Delegate = {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  count: (args: Record<string, unknown>) => Promise<number>;
  deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  createMany: (args: {
    data: Record<string, unknown>[];
  }) => Promise<{ count: number }>;
  update: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
};

function delegate(tx: DbTransaction, model: string): Delegate {
  const key = delegateKey(model);
  const d = (tx as unknown as Record<string, Delegate>)[key];
  if (!d) throw new Error(`No Prisma delegate for ${model}`);
  return d;
}

function rowId(model: string, row: Record<string, unknown>): string | null {
  if (typeof row.id === "string") return row.id;
  if (model === "NutritionTarget" && typeof row.userId === "string") {
    return row.userId;
  }
  if (
    model === "UserModule" &&
    typeof row.userId === "string" &&
    typeof row.moduleId === "string"
  ) {
    return `${row.userId}:${row.moduleId}`;
  }
  return null;
}

function prepareRow(
  model: string,
  raw: Record<string, unknown>,
  userId: string
): {
  data: Record<string, unknown>;
  selfRef: { field: string; value: unknown } | null;
  tagIds: string[] | null;
} {
  const scalars = scalarFieldNames(model);
  const dates = dateTimeFieldNames(model);
  const jsonNulls = optionalJsonFieldNames(model);
  const selfField = SELF_RELATION_FIELDS[model];

  let tagIds: string[] | null = null;
  if (model === "Task" && Array.isArray(raw.tagIds)) {
    tagIds = raw.tagIds.filter((id): id is string => typeof id === "string");
  }

  const data: Record<string, unknown> = {};
  for (const key of scalars) {
    if (!(key in raw)) continue;
    let value = raw[key];
    if (key === "userId") {
      data.userId = userId;
      continue;
    }
    if (dates.has(key) && typeof value === "string") {
      value = new Date(value);
    }
    if (jsonNulls.has(key) && value === null) {
      value = Prisma.DbNull;
    }
    data[key] = value;
  }

  let selfRef: { field: string; value: unknown } | null = null;
  if (selfField && selfField in data && data[selfField] != null) {
    selfRef = { field: selfField, value: data[selfField] };
    data[selfField] = null;
  }

  return { data, selfRef, tagIds };
}

async function assertEmptyAccount(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  for (const model of exportedModels()) {
    if (DEFAULT_MODELS.has(model)) continue;
    const n = await delegate(tx, model).count({
      where: ownerFilter(model, userId),
    });
    if (n > 0) {
      throw new ImportHttpError(409, {
        error:
          "Import works into an empty account. Export this one first, then erase it under Settings → Data.",
      });
    }
  }
}

async function deleteDefaults(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  for (const model of DEFAULT_MODELS) {
    await delegate(tx, model).deleteMany({
      where: ownerFilter(model, userId),
    });
  }
}

function validateForeignKeys(
  model: string,
  row: Record<string, unknown>,
  idsByModel: Map<string, Set<string>>
): void {
  for (const { field, relatedModel } of relationScalars(model)) {
    const value = row[field];
    if (value == null) continue;
    if (typeof value !== "string") {
      throw new ImportHttpError(400, {
        error: `Invalid foreign key ${model}.${field}`,
      });
    }
    // Related model may be excluded (never in the file) — only User is skipped
    // via relationScalars. Anything else must appear in the file.
    const allowed = idsByModel.get(relatedModel);
    if (!allowed || !allowed.has(value)) {
      throw new ImportHttpError(400, {
        error: `Foreign reference ${model}.${field}=${value} is not in the file`,
      });
    }
  }
}

async function createManyBatched(
  tx: DbTransaction,
  model: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  const d = delegate(tx, model);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    await d.createMany({ data: slice });
  }
}

async function applySelfRefs(
  tx: DbTransaction,
  model: string,
  patches: { id: string; field: string; value: unknown }[]
): Promise<void> {
  if (patches.length === 0) return;
  const d = delegate(tx, model);
  // Group by parent id so identical parents share an update shape; still one
  // update per child row (each child has its own id).
  for (const patch of patches) {
    await d.update({
      where: { id: patch.id },
      data: { [patch.field]: patch.value },
    });
  }
}

async function connectTaskTags(
  tx: DbTransaction,
  links: { taskId: string; tagIds: string[] }[]
): Promise<void> {
  for (const { taskId, tagIds } of links) {
    if (tagIds.length === 0) continue;
    await delegate(tx, "Task").update({
      where: { id: taskId },
      data: {
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
    });
  }
}

export async function parseImportLines(
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
  byteLength?: number,
  maxInflatedBytes: number = MAX_DECOMPRESSED_BYTES
): Promise<{
  header: ImportHeader;
  lines: { m: string; r: Record<string, unknown> }[];
}> {
  if (byteLength != null && byteLength > MAX_BYTES) {
    throw new ImportHttpError(413, { error: "File too large (max 200 MB)" });
  }

  const nodeStream =
    typeof (body as ReadableStream<Uint8Array>).getReader === "function"
      ? Readable.fromWeb(body as import("node:stream/web").ReadableStream)
      : (body as NodeJS.ReadableStream);

  const gunzip = createGunzip();
  // readline ends quietly when its input errors, so a truncated or corrupt
  // file would otherwise import whatever lines came before the break.
  let streamError: Error | null = null;
  gunzip.on("error", (err: Error) => {
    streamError = err;
  });
  let inflated = 0;
  gunzip.on("data", (chunk: Buffer) => {
    inflated += chunk.length;
    if (inflated > maxInflatedBytes) {
      gunzip.destroy(
        new ImportHttpError(413, { error: "File expands past 512 MB" })
      );
    }
  });
  const rl = createInterface({
    input: nodeStream.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let header: ImportHeader | null = null;
  const lines: { m: string; r: Record<string, unknown> }[] = [];
  let first = true;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new ImportHttpError(400, {
          error: "Invalid NDJSON in export file",
        });
      }
      if (first) {
        first = false;
        header = parsed as ImportHeader;
        continue;
      }
      const entry = parsed as { m?: string; r?: Record<string, unknown> };
      if (!entry.m || !entry.r || typeof entry.r !== "object") {
        throw new ImportHttpError(400, { error: "Invalid export line" });
      }
      lines.push({ m: entry.m, r: entry.r });
    }
  } catch (err) {
    if (err instanceof ImportHttpError) throw err;
    streamError =
      streamError ?? (err instanceof Error ? err : new Error(String(err)));
  }

  const failed = streamError as Error | null;
  if (failed) {
    throw failed instanceof ImportHttpError
      ? failed
      : new ImportHttpError(400, {
          error: "The export file is damaged or incomplete",
        });
  }
  if (!header) {
    throw new ImportHttpError(400, { error: "Missing export header" });
  }
  return { header, lines };
}

export function validateHeader(
  header: ImportHeader,
  localSchema: string
): "ok" | "upgrade" {
  if (header.format !== "sigwald-export") {
    throw new ImportHttpError(400, { error: "Not a Sigwald export file" });
  }
  if (header.formatVersion !== 1) {
    throw new ImportHttpError(400, {
      error: `Unknown formatVersion ${header.formatVersion}`,
    });
  }
  if (!header.schema || typeof header.schema !== "string") {
    throw new ImportHttpError(400, {
      error: "Missing schema in export header",
    });
  }
  if (header.schema > localSchema) {
    throw new ImportHttpError(409, {
      error: "This file is from a newer Sigwald. Update first.",
    });
  }
  if (header.schema < localSchema) return "upgrade";
  return "ok";
}

/**
 * Imports a parsed export into the caller's empty account inside one
 * transaction. Any failure rolls everything back.
 */
export async function importAccount(
  userId: string,
  header: ImportHeader,
  lines: { m: string; r: Record<string, unknown> }[]
): Promise<ImportResult> {
  return prisma.$transaction(
    async (tx) => {
      const localSchema = await latestMigrationName(tx);
      const mode = validateHeader(header, localSchema);

      await assertEmptyAccount(tx, userId);
      await deleteDefaults(tx, userId);

      const idsByModel = new Map<string, Set<string>>();
      for (const model of exportedModels()) {
        idsByModel.set(model, new Set());
      }

      // Collect ids first so FK checks can see later self-refs in the same model.
      for (const { m, r } of lines) {
        const spec = MODEL_SPECS[m];
        if (!spec || (spec.class !== "include" && spec.class !== "strip")) {
          throw new ImportHttpError(400, {
            error: `Model ${m} is not importable`,
          });
        }
        let row = r;
        if (mode === "upgrade") {
          row = upgradeRow(m, row, header.schema);
        }
        const id = rowId(m, row);
        if (id) idsByModel.get(m)!.add(id);
      }

      const counts: Record<string, number> = {};
      const reconnect: ReconnectItem[] = [];
      const pendingByModel = new Map<
        string,
        {
          rows: Record<string, unknown>[];
          selfRefs: { id: string; field: string; value: unknown }[];
          tagLinks: { taskId: string; tagIds: string[] }[];
        }
      >();

      for (const { m, r: raw } of lines) {
        let row = raw;
        if (mode === "upgrade") {
          row = upgradeRow(m, row, header.schema);
        }

        validateForeignKeys(m, row, idsByModel);

        const { data, selfRef, tagIds } = prepareRow(m, row, userId);
        const id = rowId(m, data);
        if (!pendingByModel.has(m)) {
          pendingByModel.set(m, { rows: [], selfRefs: [], tagLinks: [] });
        }
        const bucket = pendingByModel.get(m)!;
        bucket.rows.push(data);
        if (selfRef && id && typeof id === "string" && !id.includes(":")) {
          bucket.selfRefs.push({
            id,
            field: selfRef.field,
            value: selfRef.value,
          });
        }
        if (tagIds && id) {
          bucket.tagLinks.push({ taskId: id, tagIds });
        }

        if (m === "ConnectedAccount") {
          reconnect.push({
            kind: "account",
            provider: String(row.provider ?? ""),
            email: String(row.email ?? ""),
          });
        }
        if (m === "TaskProvider") {
          reconnect.push({
            kind: "provider",
            type: String(row.type ?? ""),
            name: String(row.name ?? ""),
          });
        }
      }

      // Insert in file order of first appearance, which matches export insert
      // order (section 3). Grouped createMany per model preserves that.
      const seen = new Set<string>();
      const modelOrder: string[] = [];
      for (const { m } of lines) {
        if (!seen.has(m)) {
          seen.add(m);
          modelOrder.push(m);
        }
      }

      for (const model of modelOrder) {
        const bucket = pendingByModel.get(model);
        if (!bucket) continue;
        await createManyBatched(tx, model, bucket.rows);
        await applySelfRefs(tx, model, bucket.selfRefs);
        counts[model] = (counts[model] ?? 0) + bucket.rows.length;
      }

      const taskBucket = pendingByModel.get("Task");
      if (taskBucket) {
        await connectTaskTags(tx, taskBucket.tagLinks);
      }

      logger.info(
        "Account imported",
        { userId, counts: JSON.stringify(counts) },
        LOG_SOURCE
      );
      return { counts, reconnect };
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 30_000 }
  );
}

/** Full import from a multipart file body. */
export async function importAccountFromStream(
  userId: string,
  body: ReadableStream<Uint8Array>,
  byteLength?: number
): Promise<ImportResult> {
  const { header, lines } = await parseImportLines(body, byteLength);
  // Header schema check against live DB happens inside the transaction so the
  // empty-account check and writes share one snapshot. Pre-validate format
  // early to fail fast without opening a transaction for junk files.
  if (header.format !== "sigwald-export") {
    throw new ImportHttpError(400, { error: "Not a Sigwald export file" });
  }
  if (header.formatVersion !== 1) {
    throw new ImportHttpError(400, {
      error: `Unknown formatVersion ${header.formatVersion}`,
    });
  }
  return importAccount(userId, header, lines);
}
