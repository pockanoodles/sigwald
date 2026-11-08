/**
 * The top bar's search across everything a person keeps (server only): the
 * core's tasks and events, then whatever the modules they have on find.
 * Pages and commands are matched in the browser; this is the data.
 */
import { newDate } from "@/lib/date-utils";
import type { Db } from "@/lib/prisma";

import { moduleSearch } from "@/modules/hooks";
import { moduleView } from "@/modules/state";

import { searchEvents, searchTasks } from "./core";
import { OTHER_FIELD_RANK, topByKeys } from "./rank";
import type { SearchGroup, SearchQuery } from "./types";

export async function searchEverything(
  db: Db,
  userId: string,
  text: string
): Promise<SearchGroup[]> {
  const [modules, settings] = await Promise.all([
    moduleView(userId),
    db.userSettings.findUnique({
      where: { userId },
      select: { timeZone: true, timeFormat: true },
    }),
  ]);
  const q: SearchQuery = {
    text,
    now: newDate(),
    timeZone: settings?.timeZone || "UTC",
    timeFormat: settings?.timeFormat === "24h" ? "24h" : "12h",
  };
  const groups = await Promise.all([
    searchTasks(db, userId, q, modules.hidden),
    searchEvents(db, userId, q),
    moduleSearch(db, userId, q, modules.isOn),
  ]);
  // The group whose best hit matches best goes first, so Enter in the
  // palette takes a goal named "offer" over a task that only mentions it in
  // its notes. Coarsely: a whole-name match, then any name match, then a
  // match elsewhere. Finer than that, "Netflix: Streaming…" (a PDF) would
  // beat "Assignment 8 (Netflix)" for "netflix", when the assignment is what
  // you're after. Ties keep the core's groups ahead, then the catalog's order.
  return topByKeys(
    groups.flat().filter((g) => g.hits.length > 0),
    (g) => [tier(Math.min(...g.hits.map((h) => h.rank)))],
    Number.POSITIVE_INFINITY
  );
}

function tier(rank: number): number {
  return rank === 0 ? 0 : rank < OTHER_FIELD_RANK ? 1 : 2;
}
