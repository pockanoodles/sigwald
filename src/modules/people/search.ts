/** People in the top bar's search (server only). */
import type { Db } from "@/lib/prisma";
import { matchRank, topByKeys } from "@/lib/search/rank";
import {
  SEARCH_CANDIDATES,
  SEARCH_GROUP_LIMIT,
  type SearchGroup,
  type SearchQuery,
} from "@/lib/search/types";

/** By name, org, role or email; archived people last. */
export async function searchPeople(
  db: Db,
  userId: string,
  q: SearchQuery
): Promise<SearchGroup[]> {
  const has = { contains: q.text, mode: "insensitive" as const };
  const rows = await db.person.findMany({
    where: {
      userId,
      OR: [{ name: has }, { org: has }, { role: has }, { email: has }],
    },
    select: { id: true, name: true, org: true, role: true, archived: true },
    orderBy: { name: "asc" },
    take: SEARCH_CANDIDATES,
  });
  const best = topByKeys(
    rows,
    (p) => [matchRank(p.name, q.text), p.archived ? 1 : 0],
    SEARCH_GROUP_LIMIT
  );
  return [
    {
      id: "people",
      label: "People",
      hits: best.map((p) => ({
        id: p.id,
        title: p.name,
        detail:
          [p.role, p.org, p.archived ? "Archived" : null]
            .filter(Boolean)
            .join(" · ") || null,
        href: `/people?person=${encodeURIComponent(p.id)}`,
        rank: matchRank(p.name, q.text),
      })),
    },
  ];
}
