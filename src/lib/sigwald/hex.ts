/**
 * Hexes: the year splits into six fixed two-month blocks (Jan–Feb, Mar–Apr,
 * May–Jun, Jul–Aug, Sep–Oct, Nov–Dec). The current hex always exists — there
 * is no "no active season" state; `ensureCurrentHex` lazily provisions the
 * GoalCycle row for the hex covering today.
 */

import type { GoalCycle } from "@prisma/client";

import { newDate } from "@/lib/date-utils";
import type { Db } from "@/lib/prisma";

import { deactivateActiveCycles } from "./goal-cycles";

export interface Hex {
  year: number;
  /** 1–6 within the year */
  index: number;
  /** first day of the first month, UTC midnight */
  startDate: Date;
  /** last day of the second month, 23:59:59.999 UTC */
  endDate: Date;
}

const MONTH_ABBREV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function hexForDate(date: Date): Hex {
  const year = date.getUTCFullYear();
  const index = Math.floor(date.getUTCMonth() / 2) + 1;
  return hexOf(year, index);
}

export function hexOf(year: number, index: number): Hex {
  const startMonth = (index - 1) * 2;
  return {
    year,
    index,
    startDate: new Date(Date.UTC(year, startMonth, 1)),
    // Day 0 of month+2 = last day of the hex's second month.
    endDate: new Date(Date.UTC(year, startMonth + 2, 0, 23, 59, 59, 999)),
  };
}

/** e.g. "Jul–Aug" */
export function hexMonths(index: number): string {
  const startMonth = (index - 1) * 2;
  return `${MONTH_ABBREV[startMonth]}–${MONTH_ABBREV[startMonth + 1]}`;
}

/** e.g. "Hex 4 · Jul–Aug 2026" */
export function hexLabel(hex: Pick<Hex, "year" | "index">): string {
  return `Hex ${hex.index} · ${hexMonths(hex.index)} ${hex.year}`;
}

/** The hex a calendar day ("2026-10-24") falls in. */
export function hexOfDay(day: string): Pick<Hex, "year" | "index"> {
  return {
    year: Number(day.slice(0, 4)),
    index: Math.floor((Number(day.slice(5, 7)) - 1) / 2) + 1,
  };
}

/** A hex's first and last calendar days, as YYYY-MM-DD. */
export function hexDayRange(hex: Pick<Hex, "year" | "index">): {
  first: string;
  last: string;
} {
  const { startDate, endDate } = hexOf(hex.year, hex.index);
  return {
    first: startDate.toISOString().slice(0, 10),
    last: endDate.toISOString().slice(0, 10),
  };
}

/**
 * Returns the GoalCycle for the hex covering today, creating and activating it
 * if needed. Any active cycle that has already ended is marked completed;
 * other stray actives are archived (one active cycle per user).
 *
 * A new hex inherits the Build of the hex before it. A Build holds until it is
 * respecced, the way the map's Current Build does, and seasons there don't
 * break at hex boundaries. A Build the vault set stays the vault's until the
 * next projection says otherwise.
 *
 * A hex's first requests arrive together (the page, the worker, the morning
 * goal projection), and each used to find no cycle and make one: three
 * copies on 2026-11-01, which later calls then took turns activating. The
 * database now allows one cycle per person per hex, so the requests that
 * lose that race fail to insert, and read the winner's instead.
 */
export async function ensureCurrentHex(
  prisma: Db,
  userId: string
): Promise<GoalCycle> {
  try {
    return await provisionCurrentHex(prisma, userId);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another request made this hex's cycle first: it's committed now.
    return provisionCurrentHex(prisma, userId);
  }
}

/** Prisma's unique-constraint error, read by its code so this file stays browser-safe. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

async function provisionCurrentHex(
  prisma: Db,
  userId: string
): Promise<GoalCycle> {
  const now = newDate();
  const hex = hexForDate(now);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.goalCycle.findFirst({
      where: { userId, startDate: hex.startDate, endDate: hex.endDate },
    });
    if (existing) {
      if (existing.status === "active") {
        return existing;
      }
      await deactivateActiveCycles(tx, userId, existing.id);
      return tx.goalCycle.update({
        where: { id: existing.id },
        data: { status: "active" },
      });
    }

    // Rollover: actives that have ended are completed, not archived.
    await tx.goalCycle.updateMany({
      where: { userId, status: "active", endDate: { lt: now } },
      data: { status: "completed" },
    });
    await deactivateActiveCycles(tx, userId);
    const previous = await tx.goalCycle.findFirst({
      where: { userId, startDate: { lt: hex.startDate } },
      orderBy: { startDate: "desc" },
      select: { focusStats: true, buildProjected: true },
    });
    return tx.goalCycle.create({
      data: {
        theme: "",
        focusStats: previous?.focusStats ?? [],
        buildProjected: previous?.buildProjected ?? false,
        startDate: hex.startDate,
        endDate: hex.endDate,
        status: "active",
        userId,
      },
    });
  });
}
