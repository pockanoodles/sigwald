/** Courses and their Canvas materials in the top bar's search (server only). */
import { courseTab } from "@/components/courses/course-tab";
import { kindLabel } from "@/components/packet/material-meta";

import type { Db } from "@/lib/prisma";
import { matchRank, topByKeys } from "@/lib/search/rank";
import {
  SEARCH_CANDIDATES,
  SEARCH_GROUP_LIMIT,
  type SearchGroup,
  type SearchQuery,
} from "@/lib/search/types";

/**
 * Materials worth finding by name: files, pages and links. Assignments,
 * quizzes and discussions are tasks already (the Tasks group finds them), and
 * a subheader is only a label in a module.
 */
const FINDABLE_KINDS = ["FILE", "PAGE", "EXTERNAL_URL", "EXTERNAL_TOOL"];

/** A course by name or code; a material by title or file name. */
export async function searchCourses(
  db: Db,
  userId: string,
  q: SearchQuery
): Promise<SearchGroup[]> {
  const has = { contains: q.text, mode: "insensitive" as const };
  const [courses, materials] = await Promise.all([
    db.course.findMany({
      where: { userId, OR: [{ name: has }, { code: has }] },
      select: { id: true, name: true, code: true, termName: true },
      orderBy: { name: "asc" },
      take: SEARCH_CANDIDATES,
    }),
    db.courseMaterial.findMany({
      where: {
        course: { userId },
        kind: { in: FINDABLE_KINDS },
        OR: [{ title: has }, { fileName: has }],
      },
      select: {
        id: true,
        title: true,
        kind: true,
        fileName: true,
        course: { select: { code: true, name: true } },
      },
      orderBy: { lastSyncedAt: "desc" },
      take: SEARCH_CANDIDATES,
    }),
  ]);

  const bestCourses = topByKeys(
    courses,
    (c) => [Math.min(matchRank(c.name, q.text), matchRank(c.code, q.text))],
    SEARCH_GROUP_LIMIT
  );
  const bestMaterials = topByKeys(
    materials,
    (m) => [matchRank(m.title, q.text)],
    SEARCH_GROUP_LIMIT
  );

  return [
    {
      id: "courses",
      label: "Courses",
      hits: bestCourses.map((c) => ({
        id: c.id,
        title: c.name,
        detail: c.termName,
        href: `/courses?course=${encodeURIComponent(c.id)}`,
        rank: Math.min(matchRank(c.name, q.text), matchRank(c.code, q.text)),
      })),
    },
    {
      id: "materials",
      label: "Materials",
      hits: bestMaterials.map((m) => ({
        id: m.id,
        title: m.title,
        detail: [
          courseTab(m.course),
          kindLabel(m as Parameters<typeof kindLabel>[0]),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/courses?m=${encodeURIComponent(m.id)}`,
        rank: matchRank(m.title, q.text),
      })),
    },
  ];
}
