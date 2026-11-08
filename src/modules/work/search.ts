/** Jobs and their contacts in the top bar's search (server only). */
import type { Db } from "@/lib/prisma";
import { matchRank, topByKeys } from "@/lib/search/rank";
import {
  SEARCH_CANDIDATES,
  SEARCH_GROUP_LIMIT,
  type SearchGroup,
  type SearchQuery,
} from "@/lib/search/types";

/**
 * A job by name, and a contact by name or role, which opens the job they're
 * listed under: the Work page shows contacts on their job. Archived last.
 */
export async function searchWork(
  db: Db,
  userId: string,
  q: SearchQuery
): Promise<SearchGroup[]> {
  const has = { contains: q.text, mode: "insensitive" as const };
  const [jobs, contacts] = await Promise.all([
    db.job.findMany({
      where: { userId, name: has },
      select: { id: true, name: true, archived: true },
      orderBy: { name: "asc" },
      take: SEARCH_CANDIDATES,
    }),
    db.jobContact.findMany({
      where: { job: { userId }, OR: [{ name: has }, { role: has }] },
      select: {
        id: true,
        name: true,
        role: true,
        job: { select: { id: true, name: true, archived: true } },
      },
      orderBy: { name: "asc" },
      take: SEARCH_CANDIDATES,
    }),
  ]);
  const rows = [
    ...jobs.map((j) => ({
      id: j.id,
      title: j.name,
      detail: j.archived ? "Job · Archived" : "Job",
      jobId: j.id,
      archived: j.archived,
    })),
    ...contacts.map((c) => ({
      id: c.id,
      title: c.name,
      detail: [c.role, c.job.name].filter(Boolean).join(" · "),
      jobId: c.job.id,
      archived: c.job.archived,
    })),
  ];
  const best = topByKeys(
    rows,
    (r) => [matchRank(r.title, q.text), r.archived ? 1 : 0],
    SEARCH_GROUP_LIMIT
  );
  return [
    {
      id: "work",
      label: "Work",
      hits: best.map((r) => ({
        id: r.id,
        title: r.title,
        detail: r.detail,
        href: `/work?job=${encodeURIComponent(r.jobId)}`,
        rank: matchRank(r.title, q.text),
      })),
    },
  ];
}
