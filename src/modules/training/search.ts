/** Routines in the top bar's search (server only). */
import type { Db } from "@/lib/prisma";
import { matchRank, topByKeys } from "@/lib/search/rank";
import {
  SEARCH_CANDIDATES,
  SEARCH_GROUP_LIMIT,
  type SearchGroup,
  type SearchQuery,
} from "@/lib/search/types";

/** By name; archived routines last. */
export async function searchRoutines(
  db: Db,
  userId: string,
  q: SearchQuery
): Promise<SearchGroup[]> {
  const rows = await db.routine.findMany({
    where: { userId, name: { contains: q.text, mode: "insensitive" } },
    select: { id: true, name: true, minutes: true, archived: true },
    orderBy: { name: "asc" },
    take: SEARCH_CANDIDATES,
  });
  const best = topByKeys(
    rows,
    (r) => [matchRank(r.name, q.text), r.archived ? 1 : 0],
    SEARCH_GROUP_LIMIT
  );
  return [
    {
      id: "routines",
      label: "Routines",
      hits: best.map((r) => ({
        id: r.id,
        title: r.name,
        detail: r.archived ? "Archived" : `${r.minutes} min`,
        href: `/training?routine=${encodeURIComponent(r.id)}`,
        rank: matchRank(r.name, q.text),
      })),
    },
  ];
}
