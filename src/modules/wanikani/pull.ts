/**
 * WaniKani's pull: the reviews and lessons available now, from the summary.
 * Each kind is one task per day in your zone ("Do 42 WaniKani reviews", id
 * `reviews:2026-11-11`), open while any are waiting and done once none are.
 * An earlier day's task that was never cleared simply stops being listed.
 */
import { summary, user } from "@/lib/connectors/wanikani/client";
import { dayIn } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledReading,
  type PulledTask,
  dueDay,
  fact,
} from "@/modules/connect/pull";

const KINDS = [
  { kind: "reviews", noun: "review", impact: 0.5 },
  { kind: "lessons", noun: "lesson", impact: 0.3 },
] as const;

/** Items in every slot whose time has come. */
export function waiting(
  slots: readonly { available_at: string; subject_ids: number[] }[],
  now: Date
): number {
  return slots
    .filter((s) => new Date(s.available_at).getTime() <= now.getTime())
    .reduce((total, s) => total + s.subject_ids.length, 0);
}

export const pullWaniKani: PullFn = async (ctx) => {
  const { http, secret, now, timeZone } = ctx;
  const me = await user(http, secret);
  const report = await summary(http, secret);
  const today = dayIn(now, timeZone);
  const counts = {
    reviews: waiting(report.data.reviews ?? [], now),
    lessons: waiting(report.data.lessons ?? [], now),
  };

  const items: PulledTask[] = [];
  for (const k of KINDS) {
    const count = counts[k.kind];
    const externalId = `${k.kind}:${today}`;
    const held = ctx.open.find((o) => o.externalId === externalId);
    if (count > 0) {
      items.push({
        kind: "task",
        externalId,
        title: `Do ${count} WaniKani ${k.noun}${count === 1 ? "" : "s"}`,
        state: "open",
        url: `https://www.wanikani.com/subjects/${k.noun}`,
        due: dueDay(today),
        impact: k.impact,
        group: { key: "wanikani:study:japanese", label: "WaniKani" },
        facts: [...fact("Waiting", count), ...fact("Level", me.data.level)],
      });
    } else if (held) {
      items.push({
        kind: "task",
        externalId,
        title: held.title,
        state: "done",
        doneAt: now,
      });
    }
  }

  const readings: PulledReading[] = [
    { key: "level", label: "Level", value: me.data.level, unit: "count" },
    {
      key: "reviews",
      label: "Reviews waiting",
      value: counts.reviews,
      unit: "count",
    },
    {
      key: "lessons",
      label: "Lessons waiting",
      value: counts.lessons,
      unit: "count",
    },
  ];
  return { items, complete: true, readings };
};
