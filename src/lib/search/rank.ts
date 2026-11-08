/**
 * How the search orders what it found. The database only answers "does it
 * contain the text"; this decides which of those reads as the thing you meant.
 * Pure, and safe in the browser.
 */

/**
 * How well a name matches, lower is better: the whole name, then a name that
 * starts with the text, then one with a word that does ("Netflix" in
 * "Assignment 8 (Netflix)"), then the text anywhere in it. Null when it isn't
 * in the name at all.
 */
export function nameRank(
  name: string | null | undefined,
  text: string
): number | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const t = text.toLowerCase();
  if (n === t) return 0;
  if (n.startsWith(t)) return 1;
  const at = n.indexOf(t);
  if (at === -1) return null;
  return /[\p{L}\p{N}]/u.test(n[at - 1]) ? 3 : 2;
}

/** Below every name match: it was found in a second field (notes, an org). */
export const OTHER_FIELD_RANK = 4;

/** A row's rank: its name's, or below every name match when another field matched. */
export function matchRank(
  name: string | null | undefined,
  text: string
): number {
  return nameRank(name, text) ?? OTHER_FIELD_RANK;
}

/**
 * The rows in order of their keys, compared left to right (lower first), cut
 * to `limit`. Ties keep the order the rows came in.
 */
export function topByKeys<T>(
  rows: readonly T[],
  keys: (row: T) => readonly number[],
  limit: number
): T[] {
  return rows
    .map((row, index) => ({ row, index, key: keys(row) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
        const d = (a.key[i] ?? 0) - (b.key[i] ?? 0);
        if (d !== 0) return d;
      }
      return a.index - b.index;
    })
    .slice(0, limit)
    .map(({ row }) => row);
}
