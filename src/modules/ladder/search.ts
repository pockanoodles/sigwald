/** Goals in the top bar's search (server only). */
import { dayIn } from "@/lib/date-utils";
import type { Db } from "@/lib/prisma";
import { matchRank, topByKeys } from "@/lib/search/rank";
import {
  SEARCH_CANDIDATES,
  SEARCH_GROUP_LIMIT,
  type SearchGroup,
  type SearchQuery,
} from "@/lib/search/types";
import { hexOfDay } from "@/lib/sigwald/hex";

/**
 * By title, live goals first, then the newest hex. A hit opens Stats on the
 * goal's own hex, which may not be the current one. A boss is a milestone on
 * a goal's path and only gets a row of its own when nothing is above it, so a
 * boss with a goal above opens that goal.
 */
export async function searchGoals(
  db: Db,
  userId: string,
  q: SearchQuery
): Promise<SearchGroup[]> {
  const rows = await db.goal.findMany({
    where: { userId, title: { contains: q.text, mode: "insensitive" } },
    select: {
      id: true,
      title: true,
      status: true,
      isBoss: true,
      cycle: { select: { theme: true, startDate: true, endDate: true } },
      parentLinks: {
        take: 1,
        select: {
          parent: {
            select: {
              id: true,
              title: true,
              cycle: { select: { startDate: true, endDate: true } },
            },
          },
        },
      },
    },
    orderBy: { cycle: { startDate: "desc" } },
    take: SEARCH_CANDIDATES,
  });
  const best = topByKeys(
    rows,
    (g) => [
      matchRank(g.title, q.text),
      g.status === "active" ? 0 : g.status === "done" ? 1 : 2,
    ],
    SEARCH_GROUP_LIMIT
  );
  return [
    {
      id: "goals",
      label: "Goals",
      hits: best.map((g) => {
        const above = g.isBoss ? g.parentLinks[0]?.parent : undefined;
        const opens = above ?? g;
        // The middle of its cycle, so a boundary stored a few hours off still names the right hex.
        const mid = new Date(
          (opens.cycle.startDate.getTime() + opens.cycle.endDate.getTime()) / 2
        );
        const hex = hexOfDay(dayIn(mid, q.timeZone));
        const state =
          g.status === "done"
            ? "Done"
            : g.status === "dropped"
              ? "Set aside"
              : null;
        return {
          id: g.id,
          title: g.title,
          detail:
            [
              above ? `Boss of ${above.title}` : g.isBoss ? "Boss" : null,
              g.cycle.theme || null,
              state,
            ]
              .filter(Boolean)
              .join(" · ") || null,
          href: `/goals?goal=${encodeURIComponent(opens.id)}&year=${hex.year}&index=${hex.index}`,
          rank: matchRank(g.title, q.text),
        };
      }),
    },
  ];
}
