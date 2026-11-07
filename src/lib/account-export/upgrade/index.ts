/**
 * Ordered row upgraders for account-export files whose `schema` is older than
 * this instance's latest applied migration.
 *
 * A migration that renames or reshapes an exported column must add an entry
 * here: `{ after: "<migration name>", model, up(row) => row }`. Entries run in
 * list order for every row whose model matches, when the file's schema is
 * strictly older than this instance and `after` is newer than the file's
 * schema (string compare of timestamp-prefixed migration names).
 */

export type RowUpgrader = {
  /** Migration that introduced the change; runs when file.schema < after. */
  after: string;
  model: string;
  up: (row: Record<string, unknown>) => Record<string, unknown>;
};

export const UPGRADERS: RowUpgrader[] = [
  // Empty on purpose. Add one when a migration renames or reshapes an
  // exported column.
];

export function upgradeRow(
  model: string,
  row: Record<string, unknown>,
  fileSchema: string
): Record<string, unknown> {
  let next = row;
  for (const upgrader of UPGRADERS) {
    if (upgrader.model !== model) continue;
    if (!(fileSchema < upgrader.after)) continue;
    next = upgrader.up(next);
  }
  return next;
}
