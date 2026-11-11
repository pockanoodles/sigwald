import { delegateKey, exportedModels } from "@/lib/account-export/models";

type FindManyArgs = {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  cursor?: { id: string };
  include?: unknown;
};

export type ModelDelegate = {
  count: jest.Mock;
  findMany: jest.Mock;
  deleteMany: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
};

export function buildPrismaMock(
  seed: Record<string, Record<string, unknown>[]> = {}
) {
  const tx: Record<string, ModelDelegate> & {
    $queryRaw: jest.Mock;
    $executeRaw?: jest.Mock;
  } = {
    $queryRaw: jest.fn(async () => [
      { migration_name: "20261107120000_calendar_subscription" },
    ]),
  } as never;

  for (const model of exportedModels()) {
    const key = delegateKey(model);
    const rows = seed[model] ?? [];
    tx[key] = {
      count: jest.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        return filterRows(rows, where).length;
      }),
      findMany: jest.fn(async (args: FindManyArgs = {}) => {
        let out = filterRows(rows, args.where);
        if (
          args.orderBy &&
          typeof args.orderBy === "object" &&
          "id" in (args.orderBy as object)
        ) {
          out = [...out].sort((a, b) =>
            String(a.id).localeCompare(String(b.id))
          );
        }
        if (args.cursor?.id) {
          const idx = out.findIndex((r) => r.id === args.cursor!.id);
          out = idx >= 0 ? out.slice(idx + (args.skip ?? 0)) : out;
        } else if (args.skip) {
          out = out.slice(args.skip);
        }
        if (args.take != null) out = out.slice(0, args.take);
        if (args.include && model === "Task") {
          return out.map((row) => ({
            ...row,
            tags:
              (row.tagIds as string[] | undefined)?.map((id) => ({ id })) ?? [],
          }));
        }
        return out.map((row) => {
          const copy = { ...row };
          delete copy.tagIds;
          return copy;
        });
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({
        count: Array.isArray(data) ? data.length : 0,
      })),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => ({
          id: where.id,
          ...data,
        })
      ),
    };
  }

  // Erase also deletes these excluded models.
  tx.calendarSubscription = {
    count: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(),
    update: jest.fn(),
  };
  tx.inboundLink = {
    count: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(),
    update: jest.fn(),
  };
  tx.taskChange = {
    count: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(),
    update: jest.fn(),
  };
  // User must remain untouched on erase — provide a spy.
  tx.user = {
    count: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(),
    update: jest.fn(),
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(
      async (
        fn: (t: typeof tx) => unknown,
        // Options are ignored in the mock.
        opts?: unknown
      ) => {
        void opts;
        return fn(tx);
      }
    ),
    __tx: tx,
  };

  return prisma;
}

function filterRows(
  rows: Record<string, unknown>[],
  where?: Record<string, unknown>
): Record<string, unknown>[] {
  if (!where) return rows;
  return rows.filter((row) => matchesWhere(row, where));
}

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Nested relation filter — for the mock, seed rows may carry flat
      // `__feedUserId` / `__feedType` style fields, or we treat nested filters
      // as matching when the seed already scoped the array.
      const nested = value as Record<string, unknown>;
      if ("userId" in nested || "type" in nested) {
        if (
          "userId" in nested &&
          row.__ownerUserId != null &&
          row.__ownerUserId !== nested.userId
        ) {
          return false;
        }
        if (
          "type" in nested &&
          row.__feedType != null &&
          row.__feedType !== nested.type
        ) {
          return false;
        }
        // For relation paths like { job: { userId } }, seed rows for child
        // models carry __ownerUserId.
        continue;
      }
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}
