/**
 * Moodle's pull: the assignments and quizzes that fall due from two weeks ago
 * to 60 days ahead, as tasks due at their deadline. Moodle drops an
 * assignment from this list once it is submitted, so a held task that is no
 * longer listed is checked: a submitted assignment (yours or your group's) is
 * done, an unsubmitted one has left the window and goes. A quiz has no cheap
 * check, so it goes.
 */
import { isConnectorError } from "@/lib/connectors/errors";
import {
  type MoodleEvent,
  actionEvents,
  courseModule,
  submissionStatus,
} from "@/lib/connectors/moodle/client";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  fact,
  toDate,
} from "@/modules/connect/pull";

const DAY = 86_400_000;
const MAX_CHECKS = 20;
const KINDS: Record<string, string> = { assign: "Assignment", quiz: "Quiz" };

/** What the next pull needs to check a dropped assignment: its module and instance. */
type Cursor = Record<string, { module: string; instance: number }>;

function readCursor(value: unknown): Cursor {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Cursor)
    : {};
}

export function toTask(event: MoodleEvent, site: string): PulledTask {
  const base = site.replace(/\/+$/, "");
  const course = event.course;
  const kind = event.modulename ?? "";
  return {
    kind: "task",
    externalId: String(event.id),
    title: event.name,
    state: "open",
    url: event.action?.url ?? event.url ?? (base ? `${base}/my/` : null),
    due: dueAt(event.timesort),
    group: course
      ? {
          key: `moodle:course:${course.id}`,
          label: course.shortname || course.fullname || `Course ${course.id}`,
        }
      : null,
    facts: [
      ...fact("Type", KINDS[kind]),
      ...fact("Course", course?.fullname || course?.shortname),
    ],
  };
}

function ended(
  held: { externalId: string; title: string },
  state: "gone"
): PulledTask {
  return {
    kind: "task",
    externalId: held.externalId,
    title: held.title,
    state,
  };
}

export const pullMoodle: PullFn = async (ctx) => {
  const { http, secret, config, now } = ctx;
  const auth = { secret, config };
  const listed = await actionEvents(
    http,
    auth,
    new Date(now.getTime() - 14 * DAY),
    new Date(now.getTime() + 60 * DAY)
  );
  const wanted = listed.events.filter(
    (e) => e.modulename != null && e.modulename in KINDS
  );
  const tasks = wanted.map((e) => toTask(e, config.site ?? ""));
  let complete = listed.complete;

  const earlier = readCursor(ctx.cursor);
  const cursor: Cursor = {};
  for (const held of ctx.open) {
    if (earlier[held.externalId])
      cursor[held.externalId] = earlier[held.externalId];
  }
  for (const e of wanted) {
    if (e.modulename && e.instance) {
      cursor[String(e.id)] = { module: e.modulename, instance: e.instance };
    }
  }

  const seen = new Set(tasks.map((t) => t.externalId));
  const dropped = ctx.open.filter(
    (o) => o.kind === "task" && !seen.has(o.externalId)
  );
  const settled: PulledTask[] = [];
  if (listed.complete) {
    let checks = 0;
    for (const held of dropped) {
      const known = earlier[held.externalId];
      if (known?.module !== "assign") {
        // A quiz, or one whose module was never recorded: nothing cheap to ask.
        settled.push(ended(held, "gone"));
        delete cursor[held.externalId];
        continue;
      }
      if (checks >= MAX_CHECKS) {
        complete = false;
        continue;
      }
      checks += 1;
      try {
        // The event's `instance` is the course module: find the assignment it
        // runs, and check that one, never another that shares the number.
        const cm = await courseModule(http, auth, known.instance);
        if (!cm || cm.modname !== "assign") {
          settled.push(ended(held, "gone"));
          delete cursor[held.externalId];
          continue;
        }
        const status = await submissionStatus(http, auth, cm.instance);
        // On a group assignment a teammate's submission counts for everyone,
        // and the key owner's own record can stay unsubmitted.
        const submission = [
          status.lastattempt?.submission,
          status.lastattempt?.teamsubmission,
        ].find((s) => s?.status === "submitted");
        if (submission) {
          settled.push({
            kind: "task",
            externalId: held.externalId,
            title: held.title,
            state: "done",
            doneAt: toDate(submission.timemodified) ?? now,
          });
        } else {
          settled.push(ended(held, "gone"));
        }
        delete cursor[held.externalId];
      } catch (error) {
        if (isConnectorError(error) && error.kind === "auth") throw error;
        // The check failed: say nothing of this one, and don't vouch for the rest.
        complete = false;
      }
    }
  }
  return { items: [...tasks, ...settled], complete, cursor };
};
