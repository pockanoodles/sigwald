/**
 * Intervals.icu's pull: the planned workouts from a few days back to 14 days
 * ahead, as tasks due that day, and today's fitness, fatigue and form.
 * Intervals.icu pairs a workout with the activity done for it
 * (`paired_activity_id`): a paired workout is done. A workout whose day has
 * passed unpaired is no longer listed, so its task closes undone.
 */
import {
  type IntervalsEvent,
  wellness,
  workouts,
} from "@/lib/connectors/intervals/client";
import { dayIn, shiftDay } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledReading,
  type PulledTask,
  dueDay,
  fact,
} from "@/modules/connect/pull";

const LOOKBACK_DAYS = 3;
const AHEAD_DAYS = 14;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function toTask(event: IntervalsEvent, athleteId: string): PulledTask {
  const sport = event.type || null;
  const minutes = event.moving_time
    ? Math.max(1, Math.round(event.moving_time / 60))
    : null;
  return {
    kind: "task",
    externalId: String(event.id),
    title: event.name?.trim() || `${sport ?? "Planned"} workout`,
    state: "open",
    url: `https://intervals.icu/athlete/${encodeURIComponent(athleteId)}/calendar`,
    description: event.description ? event.description.slice(0, 4000) : null,
    due: dueDay(event.start_date_local),
    minutes,
    group: sport
      ? {
          key: `intervals:sport:${sport.toLowerCase()}`,
          label: `${sport} training`,
        }
      : null,
    facts: [
      ...fact("Sport", sport),
      ...fact("Planned minutes", minutes),
      ...fact("Planned load", event.icu_training_load),
    ],
  };
}

export const pullIntervals: PullFn = async (ctx) => {
  const { http, secret, config, now, timeZone } = ctx;
  const auth = { secret, config };
  const today = dayIn(now, timeZone);
  const events = await workouts(
    http,
    auth,
    shiftDay(today, -LOOKBACK_DAYS),
    shiftDay(today, AHEAD_DAYS)
  );

  const held = new Map(ctx.open.map((o) => [o.externalId, o.title]));
  const items: PulledTask[] = [];
  for (const event of events) {
    if (event.category !== "WORKOUT") continue;
    const id = String(event.id);
    if (event.paired_activity_id) {
      const title = held.get(id);
      // Only what's held needs saying; a workout done before it was ever seen is no task.
      if (title !== undefined) {
        items.push({
          kind: "task",
          externalId: id,
          title,
          state: "done",
          doneAt: now,
        });
      }
    } else if (event.start_date_local.slice(0, 10) >= today) {
      items.push(toTask(event, config.athleteId ?? ""));
    }
  }

  const readings: PulledReading[] = [];
  const record = await wellness(http, auth, today);
  if (
    record &&
    typeof record.ctl === "number" &&
    typeof record.atl === "number"
  ) {
    readings.push(
      {
        key: "fitness",
        label: "Fitness (CTL)",
        value: round1(record.ctl),
        unit: "count",
      },
      {
        key: "fatigue",
        label: "Fatigue (ATL)",
        value: round1(record.atl),
        unit: "count",
      },
      {
        key: "form",
        label: "Form",
        value: round1(record.ctl - record.atl),
        unit: "count",
      }
    );
  }
  return { items, complete: true, readings };
};
