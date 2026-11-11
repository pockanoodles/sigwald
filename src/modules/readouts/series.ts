/**
 * Readouts' arithmetic: from the daily readings, each number as it stands
 * and how it moved. Pure, so the page and the tests agree.
 */

export interface ReadingRow {
  module: string;
  key: string;
  label: string;
  unit: string;
  /** YYYY-MM-DD, the person's day. */
  day: string;
  value: number;
  at: string;
}

export interface Readout {
  module: string;
  key: string;
  label: string;
  unit: string;
  value: number;
  day: string;
  at: string;
  /** Now minus the value 1, 7 and 30 days before (the nearest earlier reading), when there is one. */
  change: { day1: number | null; day7: number | null; day30: number | null };
  /** Oldest first. */
  history: { day: string; value: number }[];
}

function dayMinus(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

const idOf = (r: { module: string; key: string }) => `${r.module}|${r.key}`;

/** One readout per module and key, in the order `moduleOrder` gives the modules. */
export function buildReadouts(
  rows: readonly ReadingRow[],
  moduleOrder: readonly string[]
): Readout[] {
  const groups = new Map<string, ReadingRow[]>();
  const firstSeen = new Map<string, number>();
  rows.forEach((r, i) => {
    const id = idOf(r);
    if (!firstSeen.has(id)) firstSeen.set(id, i);
    groups.set(id, [...(groups.get(id) ?? []), r]);
  });

  const out: Readout[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
    const latest = sorted[sorted.length - 1];
    const before = (n: number): number | null => {
      const cutoff = dayMinus(latest.day, n);
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].day <= cutoff) return latest.value - sorted[i].value;
      }
      return null;
    };
    out.push({
      module: latest.module,
      key: latest.key,
      label: latest.label,
      unit: latest.unit,
      value: latest.value,
      day: latest.day,
      at: latest.at,
      change: { day1: before(1), day7: before(7), day30: before(30) },
      history: sorted.map((r) => ({ day: r.day, value: r.value })),
    });
  }

  const rank = (m: string) => {
    const i = moduleOrder.indexOf(m);
    return i < 0 ? moduleOrder.length : i;
  };
  return out.sort(
    (a, b) =>
      rank(a.module) - rank(b.module) ||
      firstSeen.get(idOf(a))! - firstSeen.get(idOf(b))!
  );
}
