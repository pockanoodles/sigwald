/**
 * Holidays' pull: this year's and next year's holidays for each country,
 * the ones in the year ahead as all-day events in the person's days.
 */
import { publicHolidays } from "@/lib/connectors/nager/client";
import { dayIn, shiftDay, startOfDayIn } from "@/lib/date-utils";

import { type PullFn, type PulledEvent, fact } from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

export const pullHolidays: PullFn = async ({
  http,
  settings,
  now,
  timeZone,
}) => {
  const countries = setting
    .list(settings, "countries")
    .map((c) => c.toUpperCase());
  const regional = setting.on(settings, "regional");
  const busy = setting.on(settings, "busy");
  const today = dayIn(now, timeZone);
  const until = shiftDay(today, 365);
  const year = Number(today.slice(0, 4));

  const items: PulledEvent[] = [];
  for (const country of countries) {
    for (const y of [year, year + 1]) {
      for (const h of await publicHolidays(http, y, country)) {
        if (h.date < today || h.date > until) continue;
        if (!regional && !h.global) continue;
        items.push({
          kind: "event",
          externalId: `${country}:${h.date}:${h.name}`,
          title: countries.length > 1 ? `${h.name} (${country})` : h.name,
          state: "open",
          start: startOfDayIn(h.date, timeZone),
          end: startOfDayIn(shiftDay(h.date, 1), timeZone),
          allDay: true,
          busy,
          description: h.localName !== h.name ? h.localName : null,
          facts: [
            ...fact("Country", country),
            ...fact("Local name", h.localName),
            ...fact(
              "Where",
              h.global ? "Nationwide" : (h.counties ?? []).join(", ")
            ),
          ],
        });
      }
    }
  }
  return { items, complete: true };
};
