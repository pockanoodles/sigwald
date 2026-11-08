import { create } from "zustand";
import { persist } from "zustand/middleware";

import { ssrSafeJsonStorage } from "@/lib/storage/ssr-safe-json-storage";

import { TaskListMode, TaskStatus } from "@/types/task";

/** The core's columns; a module's column brings its own id (Courses:
 *  "materials", Ladder: "goal"). Ids are what's persisted. */
export type TaskColumnId =
  | "status"
  | "title"
  | "priority"
  | "energyLevel"
  | "preferredTime"
  | "dueDate"
  | "duration"
  | "schedule"
  | "startDate"
  | (string & {});

/** Daily-scan columns, modules' included. Energy/Time/Start date are
 *  auto-scheduler inputs and live behind the Columns picker by default. */
export const DEFAULT_VISIBLE_COLUMNS: TaskColumnId[] = [
  "status",
  "title",
  "priority",
  "dueDate",
  "materials",
  "duration",
  "goal",
  "schedule",
];

/**
 * One field's filter: the values picked, and whether a task has to carry one
 * of them ("is") or none of them ("is not"). A condition with no values picked
 * narrows nothing; it's kept only to remember an "is not" picked first.
 */
export interface FilterCondition {
  values: string[];
  exclude?: boolean;
}

/** Keyed by filter field id (components/tasks/filters/fields.ts), modules'
 *  included. A condition on a field whose module is off is kept and ignored. */
export type TaskFilterConditions = Record<string, FilterCondition>;

/** Open work: what the page shows until you pick otherwise. */
export const DEFAULT_CONDITIONS: TaskFilterConditions = {
  status: { values: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] },
};

interface TaskListViewSettings {
  // Sort settings: a core key, or a module column's own.
  sortBy:
    | "dueDate"
    | "startDate"
    | "title"
    | "status"
    | "schedule"
    | "priority"
    | "energyLevel"
    | "preferredTime"
    | "duration"
    | (string & {});
  sortDirection: "asc" | "desc";

  // Filter settings
  conditions: TaskFilterConditions;
  /** Text a task's title, notes or tags must contain. Set from the filter
   *  menu or the top bar's search, and never saved: a term left over from
   *  last week would hide tasks with nothing on screen saying so. */
  search?: string;
  /** Deferral isn't a condition: deferred tasks stay hidden until this is
   *  on, and a search shows them anyway. */
  showDeferred?: boolean;
  /**
   * Inventory query: All / Today / Upcoming / Someday. Not Focus. Default
   * All so existing `/tasks` behavior is unchanged.
   */
  listMode: TaskListMode;

  // Column visibility ("title" is always visible and not stored)
  visibleColumns: TaskColumnId[];

  /**
   * Widths set by dragging a header edge, in px. Only columns the user has
   * actually resized appear here — everything else falls back to the width in
   * the column registry, so changing a default still reaches anyone who never
   * touched that column.
   */
  columnWidths: Partial<Record<TaskColumnId, number>>;

  /** The sheet's right-hand pane showing the selected Canvas task's packet. */
  packetOpen: boolean;

  // Actions
  setSortBy: (sortBy: TaskListViewSettings["sortBy"]) => void;
  setSortDirection: (direction: TaskListViewSettings["sortDirection"]) => void;
  /** Null, or no values without "is not", drops the field's condition. */
  setCondition: (field: string, condition: FilterCondition | null) => void;
  setSearch: (search: string) => void;
  setShowDeferred: (show: boolean) => void;
  /** No conditions and no text: every task the list mode and the tabs let through. */
  clearConditions: () => void;
  /** Back to the defaults: open work, deferred hidden. Search is left alone. */
  resetFilters: () => void;
  setListMode: (mode: TaskListMode) => void;
  toggleColumn: (column: TaskColumnId) => void;
  setColumnWidth: (column: TaskColumnId, width: number) => void;
  /** Back to the registry default — the double-click on a header edge. */
  resetColumnWidth: (column: TaskColumnId) => void;
  setPacketOpen: (open: boolean) => void;
}

/** Narrow enough to park a column you rarely read, wide enough to still be
 *  grabbable; the ceiling just stops a runaway drag from stranding the sheet. */
export const MIN_COLUMN_WIDTH = 56;
export const MAX_COLUMN_WIDTH = 900;

type PersistedSettings = Partial<TaskListViewSettings> & {
  // The filter settings before conditions (version 3 and earlier).
  status?: string[];
  energyLevel?: string[];
  timePreference?: string[];
  tagIds?: string[];
  hideUpcomingTasks?: boolean;
};

/** Bring a saved blob up to this version. Exported for its tests. */
export function migrateTaskListViewSettings(
  persisted: unknown,
  version: number
): TaskListViewSettings {
  const state = persisted as PersistedSettings;
  if (
    version < 1 &&
    state.visibleColumns &&
    !state.visibleColumns.includes("materials")
  ) {
    const at = state.visibleColumns.indexOf("dueDate");
    const next = [...state.visibleColumns];
    next.splice(at === -1 ? next.length : at + 1, 0, "materials");
    state.visibleColumns = next;
  }
  // "project" was the Lord column's sort key before it was the Lord's.
  if (version < 2 && state.sortBy === "project") state.sortBy = "lord";
  // The Lord column became the Goal column.
  if (version < 3) {
    if (state.sortBy === "lord") state.sortBy = "goal";
    state.visibleColumns = state.visibleColumns?.map((c) =>
      c === "lord" ? "goal" : c
    );
    if (state.columnWidths && "lord" in state.columnWidths) {
      const { lord, ...rest } = state.columnWidths;
      state.columnWidths = { ...rest, goal: lord };
    }
  }
  // One filter per field became conditions. A cleared filter was saved as
  // no key at all (JSON drops undefined), so a missing `status` means "any
  // status", not the default.
  if (version < 4) {
    const conditions: TaskFilterConditions = {};
    const carry = (field: string, values: string[] | undefined) => {
      if (values?.length) conditions[field] = { values };
    };
    carry("status", state.status);
    carry("energyLevel", state.energyLevel);
    carry("preferredTime", state.timePreference);
    carry("tags", state.tagIds);
    if (state.hideUpcomingTasks) {
      conditions.startDate = { values: ["later"], exclude: true };
    }
    delete state.status;
    delete state.energyLevel;
    delete state.timePreference;
    delete state.tagIds;
    delete state.hideUpcomingTasks;
    state.conditions = conditions;
  }
  // The text filter stopped being saved (see `search`).
  if (version < 5) delete state.search;
  return state as TaskListViewSettings;
}

export const useTaskListViewSettings = create<TaskListViewSettings>()(
  persist(
    (set) => ({
      // Initial sort settings
      sortBy: "dueDate",
      sortDirection: "desc",

      // Initial filter settings
      conditions: DEFAULT_CONDITIONS,
      search: undefined,
      showDeferred: false,
      listMode: "all",

      visibleColumns: DEFAULT_VISIBLE_COLUMNS,
      columnWidths: {},
      packetOpen: true,

      // Actions
      setSortBy: (sortBy) => set({ sortBy }),
      setSortDirection: (sortDirection) => set({ sortDirection }),
      setCondition: (field, condition) =>
        set((state) => {
          const next = { ...state.conditions };
          if (!condition || (!condition.values.length && !condition.exclude)) {
            delete next[field];
          } else {
            next[field] = condition.exclude
              ? { values: condition.values, exclude: true }
              : { values: condition.values };
          }
          return { conditions: next };
        }),
      setSearch: (search) => set({ search: search || undefined }),
      setShowDeferred: (showDeferred) => set({ showDeferred }),
      clearConditions: () => set({ conditions: {}, search: undefined }),
      resetFilters: () =>
        set({ conditions: DEFAULT_CONDITIONS, showDeferred: false }),
      setListMode: (listMode) => set({ listMode }),
      toggleColumn: (column) =>
        set((state) => ({
          visibleColumns: state.visibleColumns.includes(column)
            ? state.visibleColumns.filter((c) => c !== column)
            : [...state.visibleColumns, column],
        })),
      setColumnWidth: (column, width) =>
        set((state) => ({
          columnWidths: {
            ...state.columnWidths,
            [column]: Math.round(
              Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width))
            ),
          },
        })),
      resetColumnWidth: (column) =>
        set((state) => {
          // Drop the entry rather than writing the default into it, so the
          // column goes back to tracking the registry.
          const next = { ...state.columnWidths };
          delete next[column];
          return { columnWidths: next };
        }),
      setPacketOpen: (packetOpen) => set({ packetOpen }),
    }),
    {
      name: "task-list-view-settings",
      storage: ssrSafeJsonStorage,
      // No migration needed for `columnWidths` or `packetOpen`: persist's
      // default merge is `{...initial, ...persisted}`, so a blob written
      // before a key existed simply leaves its initial value in place.
      // `visibleColumns` is different — a saved list replaces the default
      // wholesale, so a new default column has to be added to it explicitly.
      version: 5,
      migrate: migrateTaskListViewSettings,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ search, ...saved }) => saved,
    }
  )
);
