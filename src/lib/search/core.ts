/**
 * The core's own search sources: tasks and calendar events (server only).
 * Each module adds its own through the registry (src/modules/server.ts).
 */
import { dayIn, startOfDayIn } from "@/lib/date-utils";
import type { Db } from "@/lib/prisma";
import { dueBy, dueDay } from "@/lib/sigwald/due";
import { humanCountdown } from "@/lib/sigwald/human-countdown";

import { visibleSourceWhere } from "@/modules/state";

import { OTHER_FIELD_RANK, matchRank, topByKeys } from "./rank";
import {
  SEARCH_CANDIDATES,
  SEARCH_GROUP_LIMIT,
  type SearchGroup,
  type SearchQuery,
} from "./types";
import { wordDay, wordDue, wordMoment } from "./when";

const contains = (text: string) => ({
  contains: text,
  mode: "insensitive" as const,
});

/**
 * Tasks by title or notes, open work first and soonest due first within it.
 * A subtask opens its parent, since the sheet nests children under theirs.
 * Tasks of a module that's off stay out, as they do from every list.
 */
export async function searchTasks(
  db: Db,
  userId: string,
  q: SearchQuery,
  hiddenSources: readonly string[]
): Promise<SearchGroup> {
  const rows = await db.task.findMany({
    where: {
      userId,
      AND: [
        visibleSourceWhere(hiddenSources),
        {
          OR: [{ title: contains(q.text) }, { description: contains(q.text) }],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      closedAt: true,
      dueDate: true,
      source: true,
      parentTaskId: true,
      parentTask: { select: { title: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: SEARCH_CANDIDATES,
  });

  const now = q.now.getTime();
  const due = new Map(
    rows.map((r) => [
      r.id,
      r.dueDate ? dueBy(r.dueDate, r.source, q.timeZone) : null,
    ])
  );
  const finished = (r: (typeof rows)[number]) =>
    r.status === "completed" || r.closedAt != null;

  const best = topByKeys(
    rows,
    (r) => {
      const at = due.get(r.id)?.getTime();
      const rank = matchRank(r.title, q.text);
      return [
        // Named in the title beats found in the notes; within either, open
        // work beats finished, then the closer the name matches.
        rank === OTHER_FIELD_RANK ? 1 : 0,
        finished(r) ? 1 : 0,
        rank,
        // Undated after dated; among dated, the nearest deadline either side of now.
        at == null ? 1 : 0,
        at == null ? 0 : Math.abs(at - now),
      ];
    },
    SEARCH_GROUP_LIMIT
  );

  return {
    id: "tasks",
    label: "Tasks",
    hits: best.map((r) => {
      const dueAt = due.get(r.id) ?? null;
      const state =
        r.status === "completed" ? "Done" : r.closedAt ? "Closed" : null;
      return {
        id: r.id,
        title: r.title,
        detail:
          [r.parentTask ? `In ${r.parentTask.title}` : null, state]
            .filter(Boolean)
            .join(" · ") || null,
        when: !dueAt
          ? null
          : state
            ? wordDue(dueDay(r.dueDate!, r.source, q.timeZone), q)
            : humanCountdown(dueAt, q.now, q.timeZone),
        href: `/tasks?task=${encodeURIComponent(r.parentTaskId ?? r.id)}`,
        rank: matchRank(r.title, q.text),
      };
    }),
  };
}

/**
 * Events by title or place. A recurring series shows once, at its next
 * occurrence (or its latest, if it's over); upcoming beats past.
 */
export async function searchEvents(
  db: Db,
  userId: string,
  q: SearchQuery
): Promise<SearchGroup> {
  const startOfToday = startOfDayIn(dayIn(q.now, q.timeZone), q.timeZone);
  const where = {
    feed: { userId, enabled: true },
    // A series is one master row plus its expanded instances: search the instances.
    isMaster: false,
    OR: [{ title: contains(q.text) }, { location: contains(q.text) }],
  };
  const select = {
    id: true,
    title: true,
    start: true,
    allDay: true,
    location: true,
    feed: { select: { name: true } },
  } as const;
  const [upcoming, past] = await Promise.all([
    db.calendarEvent.findMany({
      where: { ...where, start: { gte: startOfToday } },
      select,
      orderBy: { start: "asc" },
      take: SEARCH_CANDIDATES,
    }),
    db.calendarEvent.findMany({
      where: { ...where, start: { lt: startOfToday } },
      select,
      orderBy: { start: "desc" },
      take: SEARCH_GROUP_LIMIT * 2,
    }),
  ]);

  // Upcoming then past, so the first of each title is the one to show.
  const seen = new Set<string>();
  const once = [...upcoming, ...past].filter((e) => {
    const key = e.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const isPast = (e: (typeof once)[number]) => e.start < startOfToday;
  const best = topByKeys(
    once,
    (e) => [matchRank(e.title, q.text), isPast(e) ? 1 : 0],
    SEARCH_GROUP_LIMIT
  );

  return {
    id: "events",
    label: "Events",
    hits: best.map((e) => {
      const day = e.allDay
        ? allDayOf(e.start, q.timeZone)
        : dayIn(e.start, q.timeZone);
      return {
        id: e.id,
        title: e.title,
        detail: e.location || e.feed.name,
        when: e.allDay ? wordDay(day, q) : wordMoment(e.start, q),
        href: `/calendar?date=${day}`,
        rank: matchRank(e.title, q.text),
      };
    }),
  };
}

/**
 * The day an all-day event is on. The syncs store it at midnight in the
 * server's zone (createAllDayDate), which is UTC midnight on a box set to UTC
 * and the person's midnight on one set to theirs; read it as whichever it is.
 */
function allDayOf(start: Date, timeZone: string): string {
  return start.getUTCHours() === 0 && start.getUTCMinutes() === 0
    ? start.toISOString().slice(0, 10)
    : dayIn(start, timeZone);
}
