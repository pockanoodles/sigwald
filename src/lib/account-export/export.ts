import { Prisma } from "@prisma/client";
import { createGzip } from "node:zlib";
import type { Gzip } from "node:zlib";

import { logger } from "@/lib/logger";
import { type DbTransaction, prisma } from "@/lib/prisma";

import packageJson from "../../../package.json";
import {
  MODEL_SPECS,
  applyStrip,
  delegateKey,
  ownerFilter,
  scalarFieldNames,
} from "./models";
import { insertOrder } from "./order";
import { latestMigrationName } from "./schema-version";

const LOG_SOURCE = "account-export";
const PAGE_SIZE = 1000;
const TX_TIMEOUT_MS = 10 * 60 * 1000;

export type ExportHeader = {
  format: "sigwald-export";
  formatVersion: 1;
  schema: string;
  app: string;
  exportedAt: string;
  counts: Record<string, number>;
};

type Delegate = {
  findMany: (
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>[]>;
  count: (args: Record<string, unknown>) => Promise<number>;
};

function delegate(tx: DbTransaction, model: string): Delegate {
  const key = delegateKey(model);
  const d = (tx as unknown as Record<string, Delegate>)[key];
  if (!d) throw new Error(`No Prisma delegate for ${model}`);
  return d;
}

function pickScalars(
  model: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  const scalars = scalarFieldNames(model);
  const out: Record<string, unknown> = {};
  for (const key of scalars) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

async function* pageModel(
  tx: DbTransaction,
  model: string,
  userId: string
): AsyncGenerator<Record<string, unknown>> {
  const where = ownerFilter(model, userId);
  const d = delegate(tx, model);
  const hasId = scalarFieldNames(model).has("id");

  if (!hasId) {
    const rows = await d.findMany({ where });
    for (const row of rows) yield row;
    return;
  }

  let cursor: string | undefined;
  for (;;) {
    const rows = await d.findMany({
      where,
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      ...(model === "Task"
        ? { include: { tags: { select: { id: true } } } }
        : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) yield row;
    if (rows.length < PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    cursor = String(last.id);
  }
}

function serializeRow(
  model: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  let out = pickScalars(model, row);
  out = applyStrip(model, out);

  if (model === "Task") {
    const tags = row.tags as { id: string }[] | undefined;
    out.tagIds = Array.isArray(tags) ? tags.map((t) => t.id) : [];
  }

  return out;
}

function writeLine(gzip: Gzip, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = gzip.write(`${JSON.stringify(value)}\n`, (err) => {
      if (err) reject(err);
    });
    if (ok) resolve();
    else gzip.once("drain", resolve);
  });
}

/**
 * Builds a gzipped NDJSON ReadableStream of the caller's account. Holds one
 * RepeatableRead transaction for the whole stream so a concurrent sync can't
 * produce dangling references.
 */
export function exportAccountStream(userId: string): {
  stream: ReadableStream<Uint8Array>;
  filename: string;
} {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `sigwald-${date}.sigwald`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const gzip = createGzip();
      gzip.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      gzip.on("end", () => controller.close());
      gzip.on("error", (err) => controller.error(err));

      void (async () => {
        try {
          await prisma.$transaction(
            async (tx) => {
              const order = insertOrder();
              const counts: Record<string, number> = {};

              for (const model of order) {
                counts[model] = await delegate(tx, model).count({
                  where: ownerFilter(model, userId),
                });
              }

              const header: ExportHeader = {
                format: "sigwald-export",
                formatVersion: 1,
                schema: await latestMigrationName(tx),
                app: packageJson.version,
                exportedAt: new Date().toISOString(),
                counts,
              };

              await writeLine(gzip, header);

              for (const model of order) {
                let n = 0;
                for await (const row of pageModel(tx, model, userId)) {
                  const serialized = serializeRow(model, row);
                  await writeLine(gzip, { m: model, r: serialized });
                  n += 1;
                }
                if (n !== counts[model]) {
                  // Counts were taken up front; RepeatableRead should match.
                  counts[model] = n;
                }
              }

              logger.info(
                "Account exported",
                { userId, counts: JSON.stringify(counts) },
                LOG_SOURCE
              );
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
              timeout: TX_TIMEOUT_MS,
              maxWait: 30_000,
            }
          );
          gzip.end();
        } catch (err) {
          gzip.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    },
  });

  return { stream, filename };
}

/** Test helper: serialize one row the way the stream does. */
export function serializeExportRow(
  model: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  return serializeRow(model, row);
}

export function isExportedModel(model: string): boolean {
  const spec = MODEL_SPECS[model];
  return !!spec && (spec.class === "include" || spec.class === "strip");
}
