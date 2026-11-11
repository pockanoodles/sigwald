/**
 * One-time backfill: encrypt the credential columns that were written before
 * encryption existed.
 *
 * Deliberately uses an **unextended** Prisma client and calls `encryptSecret`
 * itself, rather than reading and rewriting through the extension. Going
 * through the extension would mean reading a value, decrypting it, and
 * re-encrypting it — which works, but makes the script's effect depend on the
 * very layer it is migrating for. Reading the raw column and writing a raw
 * value keeps what this does visible.
 *
 * Safe to re-run: already-encrypted values are counted and skipped, never
 * double-wrapped.
 *
 *   npm run credentials:encrypt -- --dry-run   # report only
 *   npm run credentials:encrypt                # write
 */
import { PrismaClient } from "@prisma/client";

import { encryptSecret, isEncrypted } from "../src/lib/crypto/secret-box";

const prisma = new PrismaClient();

/** Mirrors ENCRYPTED_FIELDS in src/lib/crypto/prisma-encryption.ts. */
const TARGETS = [
  { model: "ConnectedAccount", fields: ["accessToken", "refreshToken"] },
  { model: "TaskProvider", fields: ["accessToken", "refreshToken"] },
  {
    model: "SystemSettings",
    fields: ["googleClientSecret", "outlookClientSecret"],
  },
  { model: "Connection", fields: ["secret"] },
] as const;

type Row = { id: string } & Record<string, unknown>;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "Dry run — reporting what would change, writing nothing.\n"
      : "Encrypting credential columns.\n"
  );

  let totalEncrypted = 0;
  let totalAlready = 0;
  let totalEmpty = 0;

  for (const { model, fields } of TARGETS) {
    // Bracket access so one loop covers every model without a union of
    // delegate types; the model names above are checked against the schema by
    // the extension that consumes the same list.
    const delegate = (
      prisma as unknown as Record<
        string,
        {
          findMany: (args?: unknown) => Promise<Row[]>;
          update: (args: unknown) => Promise<unknown>;
        }
      >
    )[model.charAt(0).toLowerCase() + model.slice(1)];

    const rows = await delegate.findMany({
      select: Object.fromEntries([
        ["id", true],
        ...fields.map((f) => [f, true]),
      ]),
    });

    for (const row of rows) {
      const patch: Record<string, string> = {};

      for (const field of fields) {
        const value = row[field];
        if (typeof value !== "string" || value === "") {
          totalEmpty += 1;
          continue;
        }
        if (isEncrypted(value)) {
          totalAlready += 1;
          continue;
        }
        patch[field] = encryptSecret(value);
        totalEncrypted += 1;
        console.log(`  ${model}.${field} (${row.id}) → encrypted`);
      }

      if (Object.keys(patch).length > 0 && !dryRun) {
        await delegate.update({ where: { id: row.id }, data: patch });
      }
    }
  }

  console.log(
    `\n${dryRun ? "Would encrypt" : "Encrypted"}: ${totalEncrypted}` +
      `  ·  already encrypted: ${totalAlready}` +
      `  ·  empty or unset: ${totalEmpty}`
  );

  if (totalEncrypted > 0 && dryRun) {
    console.log("\nRe-run without --dry-run to apply.");
  }
}

main()
  .catch((error) => {
    console.error(
      "\nBackfill failed, and nothing further was written:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
