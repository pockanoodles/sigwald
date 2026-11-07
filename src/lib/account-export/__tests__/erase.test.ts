import { eraseAccount, isEraseConfirm } from "@/lib/account-export/erase";
import { delegateKey, ownerFilter } from "@/lib/account-export/models";
import { eraseOrder } from "@/lib/account-export/order";
import { prisma } from "@/lib/prisma";

import { buildPrismaMock } from "./prisma-mock";

jest.mock("@/lib/prisma", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { buildPrismaMock } = require("./prisma-mock");
  return { prisma: buildPrismaMock() };
});

jest.mock("@/lib/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type MockPrisma = ReturnType<typeof buildPrismaMock>;
const db = prisma as unknown as MockPrisma;

describe("account erase", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const fresh = buildPrismaMock();
    Object.assign(db.__tx, fresh.__tx);
    db.$transaction.mockImplementation(((fn: (t: typeof db.__tx) => unknown) =>
      fn(db.__tx)) as typeof db.$transaction);
  });

  it("requires the exact confirm phrase", () => {
    expect(isEraseConfirm("erase my data")).toBe(true);
    expect(isEraseConfirm("Erase my data")).toBe(false);
    expect(isEraseConfirm("erase")).toBe(false);
    expect(isEraseConfirm(undefined)).toBe(false);
  });

  it("deletes in reverse insert order with owner filters and leaves User alone", async () => {
    const order = eraseOrder();
    const deleteOrder: string[] = [];

    for (const model of order) {
      const key = delegateKey(model);
      db.__tx[key].deleteMany.mockImplementation(async () => {
        deleteOrder.push(model);
        return { count: 0 };
      });
    }

    await eraseAccount("user-1");

    expect(deleteOrder).toEqual(order);
    for (const model of order) {
      const key = delegateKey(model);
      expect(db.__tx[key].deleteMany).toHaveBeenCalledWith({
        where: ownerFilter(model, "user-1"),
      });
    }

    expect(db.__tx.calendarSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(db.__tx.taskChange.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(db.__tx.user.deleteMany).not.toHaveBeenCalled();
  });
});
