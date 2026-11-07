import { logger } from "@/lib/logger";
import { type DbTransaction, prisma } from "@/lib/prisma";

import { delegateKey, ownerFilter } from "./models";
import { eraseOrder } from "./order";

const LOG_SOURCE = "account-erase";
const CONFIRM = "erase my data";
const TX_TIMEOUT_MS = 10 * 60 * 1000;

type Delegate = {
  deleteMany: (args: {
    where: Record<string, unknown>;
  }) => Promise<{ count: number }>;
};

function delegate(tx: DbTransaction, model: string): Delegate {
  const key = delegateKey(model);
  const d = (tx as unknown as Record<string, Delegate>)[key];
  if (!d) throw new Error(`No Prisma delegate for ${model}`);
  return d;
}

export function isEraseConfirm(confirm: unknown): boolean {
  return confirm === CONFIRM;
}

/**
 * Deletes the caller's rows in every include/strip model (reverse insert
 * order), plus CalendarSubscription and TaskChange. Keeps User / Account /
 * Session / PasswordReset. Does not touch files on disk.
 */
export async function eraseAccount(userId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const model of eraseOrder()) {
        await delegate(tx, model).deleteMany({
          where: ownerFilter(model, userId),
        });
      }
      await tx.calendarSubscription.deleteMany({ where: { userId } });
      await tx.taskChange.deleteMany({ where: { userId } });

      logger.info("Account data erased", { userId }, LOG_SOURCE);
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 30_000 }
  );
}
