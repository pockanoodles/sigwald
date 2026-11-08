import type { Db } from "@/lib/prisma";

import { ensureCurrentHex, hexDayRange, hexForDate, hexLabel, hexOf, hexOfDay } from "../sigwald/hex";

describe("hexForDate", () => {
  it("maps January 1 to hex 1", () => {
    const hex = hexForDate(new Date("2026-01-01T00:00:00.000Z"));
    expect(hex.index).toBe(1);
    expect(hex.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(hex.endDate.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });

  it("covers leap-year February in hex 1", () => {
    const hex = hexForDate(new Date("2028-02-29T12:00:00.000Z"));
    expect(hex.index).toBe(1);
    expect(hex.endDate.toISOString()).toBe("2028-02-29T23:59:59.999Z");
  });

  it("maps late July to hex 4 (Jul–Aug)", () => {
    const hex = hexForDate(new Date("2026-07-25T04:00:00.000Z"));
    expect(hex.index).toBe(4);
    expect(hex.startDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(hex.endDate.toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });

  it("maps December 31 to hex 6", () => {
    const hex = hexForDate(new Date("2026-12-31T23:59:59.000Z"));
    expect(hex.index).toBe(6);
    expect(hex.endDate.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("first instant of a boundary month starts the next hex", () => {
    expect(hexForDate(new Date("2026-06-30T23:59:59.999Z")).index).toBe(3);
    expect(hexForDate(new Date("2026-07-01T00:00:00.000Z")).index).toBe(4);
  });
});

describe("hexLabel", () => {
  it("formats index and month pair", () => {
    expect(hexLabel(hexOf(2026, 4))).toBe("Hex 4 · Jul–Aug 2026");
    expect(hexLabel(hexOf(2027, 1))).toBe("Hex 1 · Jan–Feb 2027");
    expect(hexLabel(hexOf(2026, 6))).toBe("Hex 6 · Nov–Dec 2026");
  });
});

describe("hexOfDay / hexDayRange", () => {
  it("names the hex a calendar day falls in, and its first and last days", () => {
    expect(hexOfDay("2026-10-31")).toEqual({ year: 2026, index: 5 });
    expect(hexOfDay("2026-11-01")).toEqual({ year: 2026, index: 6 });
    expect(hexDayRange({ year: 2028, index: 1 })).toEqual({ first: "2028-01-01", last: "2028-02-29" });
  });
});

describe("ensureCurrentHex", () => {
  it("carries the Build of the hex before into a new one, but not its theme", async () => {
    const created: Record<string, unknown>[] = [];
    const tx = {
      goalCycle: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ focusStats: ["arcane", "intelligence"], buildProjected: true }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "new", ...data };
        }),
        update: jest.fn(),
      },
    };
    const db = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as Db;
    await ensureCurrentHex(db, "user");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      theme: "",
      focusStats: ["arcane", "intelligence"],
      buildProjected: true,
      status: "active",
    });
  });

  it("reads the winner's cycle when another request made it first", async () => {
    const winner = { id: "winner", status: "active" };
    let attempt = 0;
    const db = {
      $transaction: async () => {
        attempt += 1;
        // The first try loses the insert race to a request that committed first.
        if (attempt === 1) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        return winner;
      },
    } as unknown as Db;
    await expect(ensureCurrentHex(db, "user")).resolves.toBe(winner);
    expect(attempt).toBe(2);
  });

  it("doesn't retry any other failure", async () => {
    const db = {
      $transaction: jest.fn(async () => {
        throw new Error("connection lost");
      }),
    } as unknown as Db & { $transaction: jest.Mock };
    await expect(ensureCurrentHex(db, "user")).rejects.toThrow("connection lost");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
