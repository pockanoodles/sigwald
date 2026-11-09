/**
 * What a script that reads your repos (ops' worklog pump) feeds the Code
 * module: for each repo and day, how many commits you made and their
 * messages (PUT /api/sigwald/code/days). Each repo's day becomes one finished
 * task, so the goals that claim the repo earn for it like any other work.
 *
 * The unit is a day, not a commit. Commit counts swing with how someone
 * commits (and with how much an agent writes), while a day of shipping on a
 * repo is about what a Canvas assignment is: one finished thing.
 *
 * A day is keyed `<repo>@<YYYY-MM-DD>` and written over when it grows. The
 * import adds and updates and never deletes: a branch deleted after its work
 * was done doesn't undo the work.
 */
import type { Db as Client, DbTransaction } from "@/lib/prisma";

type Db = Client | DbTransaction;

export const CODE_SOURCE = "CODE";

/** `owner/name`, lowercase: GitHub's names ignore case, and claims match exactly. */
const REPO = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /(Z|[+-]\d{2}:\d{2})$/;
/** A year of backfill across a dozen repos fits; anything bigger is a bug upstream. */
export const MAX_DAYS = 3000;
const MAX_SUBJECTS = 60;
const MAX_SUBJECT_LENGTH = 200;
const MAX_LABEL_LENGTH = 80;

/** One repo's day, as a source sends it. */
export interface WorkDay {
  /** `owner/name` from the repo's remote (`local/<folder>` without one), lowercased. */
  repo: string;
  /** What to call it ("Mahoraga"); the repo when the source sends none. */
  label: string;
  /** The calendar day, in the person's zone. */
  day: string;
  commits: number;
  /** One line per commit, newest first. */
  subjects: string[];
  /** The day's last commit: when the task counts as finished. */
  lastAt: Date;
  /** The repo's web page, if it has one. */
  url: string | null;
}

/** The task's identity: one per repo and day. */
export const workDayKey = (day: Pick<WorkDay, "repo" | "day">) => `${day.repo}@${day.day}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A PUT body's days, or what's wrong with it. */
export function parseWorkDays(raw: unknown): WorkDay[] | string {
  if (!isRecord(raw) || !Array.isArray(raw.days)) return "days must be a list";
  if (raw.days.length > MAX_DAYS) return `send at most ${MAX_DAYS} days at a time`;
  const days: WorkDay[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.days.entries()) {
    const where = `days[${i}]`;
    if (!isRecord(entry)) return `${where} must be an object`;
    const repo = typeof entry.repo === "string" ? entry.repo.trim().toLowerCase() : "";
    if (!REPO.test(repo)) return `${where}.repo must be owner/name`;
    const day = typeof entry.day === "string" ? entry.day : "";
    if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      return `${where}.day must be YYYY-MM-DD`;
    }
    const commits = entry.commits;
    if (typeof commits !== "number" || !Number.isInteger(commits) || commits < 1) {
      return `${where}.commits must be a whole number above 0`;
    }
    if (!Array.isArray(entry.subjects) || entry.subjects.some((s) => typeof s !== "string")) {
      return `${where}.subjects must be a list of strings`;
    }
    const lastAt = typeof entry.lastAt === "string" && INSTANT.test(entry.lastAt) ? new Date(entry.lastAt) : null;
    if (!lastAt || Number.isNaN(lastAt.getTime())) {
      return `${where}.lastAt must be an ISO time with its offset`;
    }
    const url = entry.url == null ? null : typeof entry.url === "string" ? entry.url : undefined;
    if (url === undefined || (url !== null && !/^https:\/\/\S+$/.test(url))) {
      return `${where}.url must be an https link or null`;
    }
    const label =
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim().slice(0, MAX_LABEL_LENGTH)
        : repo;
    const key = workDayKey({ repo, day });
    if (seen.has(key)) return `${where} repeats ${key}`;
    seen.add(key);
    days.push({
      repo,
      label,
      day,
      commits,
      subjects: (entry.subjects as string[])
        .map((s) => s.trim().slice(0, MAX_SUBJECT_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_SUBJECTS),
      lastAt,
      url,
    });
  }
  return days;
}

/** What the task says: "Mahoraga · 12 commits", and the day's messages. */
export function workDayText(day: WorkDay): { title: string; description: string | null } {
  const title = `${day.label} · ${day.commits} ${day.commits === 1 ? "commit" : "commits"}`;
  const more = day.commits - day.subjects.length;
  const lines = [
    ...day.subjects.map((s) => `- ${s}`),
    // A source that sent no messages sent none to count past.
    ...(more > 0 && day.subjects.length ? [`- and ${more} more`] : []),
  ];
  return { title, description: lines.length ? lines.join("\n") : null };
}

export interface WorkDayImport {
  /** Tasks made or changed, for the goal rules to file. */
  changed: string[];
  created: number;
  updated: number;
  unchanged: number;
}

export async function importWorkDays(db: Db, userId: string, days: WorkDay[]): Promise<WorkDayImport> {
  const existing = await db.task.findMany({
    where: { userId, source: CODE_SOURCE, externalTaskId: { in: days.map(workDayKey) } },
    select: {
      id: true,
      externalTaskId: true,
      title: true,
      description: true,
      status: true,
      completedAt: true,
      externalListId: true,
      externalUrl: true,
    },
  });
  const byKey = new Map(existing.map((task) => [task.externalTaskId, task]));

  const result: WorkDayImport = { changed: [], created: 0, updated: 0, unchanged: 0 };
  for (const day of days) {
    const fields = {
      ...workDayText(day),
      status: "completed",
      completedAt: day.lastAt,
      externalListId: day.repo,
      externalUrl: day.url,
    };
    const task = byKey.get(workDayKey(day));
    if (!task) {
      const made = await db.task.create({
        data: {
          ...fields,
          userId,
          source: CODE_SOURCE,
          externalTaskId: workDayKey(day),
          category: "WORK",
          lastSyncedAt: new Date(),
          // Task sync to Google/Outlook never takes these.
          skipSync: true,
        },
        select: { id: true },
      });
      result.changed.push(made.id);
      result.created += 1;
      continue;
    }
    const same =
      task.title === fields.title &&
      task.description === fields.description &&
      task.status === fields.status &&
      task.completedAt?.getTime() === fields.completedAt.getTime() &&
      task.externalListId === fields.externalListId &&
      task.externalUrl === fields.externalUrl;
    if (same) {
      result.unchanged += 1;
      continue;
    }
    await db.task.update({ where: { id: task.id }, data: { ...fields, lastSyncedAt: new Date() } });
    result.changed.push(task.id);
    result.updated += 1;
  }
  return result;
}
