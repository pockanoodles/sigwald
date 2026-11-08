import { create } from "zustand";
import { persist } from "zustand/middleware";

import { ssrSafeJsonStorage } from "@/lib/storage/ssr-safe-json-storage";

/** The Tasks page's two views. A phone draws the sheet as rows (TaskList). */
export type TaskViewMode = "sheet" | "board";

interface TaskPageSettings {
  viewMode: TaskViewMode;
  setViewMode: (mode: TaskViewMode) => void;
}

export const useTaskPageSettings = create<TaskPageSettings>()(
  persist(
    (set) => ({
      viewMode: "sheet",
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    {
      name: "task-page-settings",
      storage: ssrSafeJsonStorage,
      // v0 had List (drawn as Rows or Sheet) and Board. Rows is gone and the
      // list is the sheet, so a saved "list" opens the sheet.
      version: 1,
      migrate: (persisted) => {
        const old = (persisted ?? {}) as { viewMode?: string };
        return {
          viewMode: old.viewMode === "board" ? "board" : "sheet",
        } as TaskPageSettings;
      },
    }
  )
);
