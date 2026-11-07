import type { Db, DbTransaction } from "@/lib/prisma";

type MigrationRow = { migration_name: string };

/** Latest finished Prisma migration name (timestamp-prefixed, comparable). */
export async function latestMigrationName(
  db: Db | DbTransaction
): Promise<string> {
  const rows = await db.$queryRaw<MigrationRow[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL
    ORDER BY migration_name DESC
    LIMIT 1
  `;
  if (!rows[0]?.migration_name) {
    throw new Error("No applied Prisma migrations found");
  }
  return rows[0].migration_name;
}
