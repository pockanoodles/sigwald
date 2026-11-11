import { useMemo } from "react";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { ssrSafeJsonStorage } from "@/lib/storage/ssr-safe-json-storage";

import { moduleById, resolveModuleStates } from "@/modules";
import type {
  ModuleId,
  ModuleListing,
  ModuleManifest,
  ModuleState,
} from "@/modules/types";

/**
 * Which modules this person has on, for the rail, the top bar, ⌘K and the
 * catalog. Cached in localStorage so the rail draws the right modules on first
 * paint, then refreshed from the server.
 *
 * `known` stays false until there's a real answer (the cache or the server),
 * and nothing that decides on it — the rail's module list, a module's gate —
 * draws before then. Guessing from the defaults would flash "Courses is off"
 * at someone who has it on.
 */
interface ModulesStore {
  states: ModuleState[];
  known: boolean;
  fetchedAt: number | null;
  error: string | null;
  /** Throttled to once a minute unless forced; navigation calls it freely. */
  load: (opts?: { force?: boolean }) => Promise<void>;
  /** Turns a module on or off now, and puts it back if the server refuses. */
  setOn: (id: ModuleId, on: boolean) => Promise<boolean>;
  /** Moves a module one place up or down the rail. */
  move: (id: ModuleId, direction: -1 | 1) => Promise<void>;
}

const FRESH_MS = 60_000;

async function patchModule(
  id: ModuleId,
  change: { on?: boolean; position?: number }
): Promise<ModuleState[]> {
  const res = await fetch(`/api/modules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!res.ok) throw new Error(`Couldn't change ${id} (${res.status})`);
  return statesFrom(await res.json());
}

function statesFrom(body: { modules: ModuleListing[] }): ModuleState[] {
  return resolveModuleStates(
    body.modules.map((m) => ({
      moduleId: m.id,
      enabled: m.on,
      position: m.position,
    }))
  );
}

export const useModulesStore = create<ModulesStore>()(
  persist(
    (set, get) => ({
      states: resolveModuleStates([]),
      known: false,
      fetchedAt: null,
      error: null,

      load: async (opts) => {
        const { fetchedAt } = get();
        if (!opts?.force && fetchedAt && Date.now() - fetchedAt < FRESH_MS) {
          return;
        }
        set({ fetchedAt: Date.now() });
        try {
          const res = await fetch("/api/modules");
          if (!res.ok)
            throw new Error(`Modules failed to load (${res.status})`);
          set({
            states: statesFrom(await res.json()),
            known: true,
            error: null,
          });
        } catch (e) {
          set({
            fetchedAt: null,
            error: e instanceof Error ? e.message : "Modules failed to load",
          });
        }
      },

      setOn: async (id, on) => {
        const before = get().states;
        set({
          states: before.map((s) => (s.id === id ? { ...s, on } : s)),
        });
        try {
          set({ states: await patchModule(id, { on }), known: true });
          return true;
        } catch (e) {
          set({
            states: before,
            error: e instanceof Error ? e.message : "Couldn't change module",
          });
          return false;
        }
      },

      move: async (id, direction) => {
        // Only modules with a page sit in the rail, so only they trade places.
        const on = get().states.filter((s) => s.on && moduleById(s.id).page);
        const index = on.findIndex((s) => s.id === id);
        const other = on[index + direction];
        if (index < 0 || !other) return;
        // Swap the two positions; equal positions would leave the order to
        // the catalog, so the one moving gets a distinct slot.
        const mine = on[index].position;
        const theirs =
          other.position === mine ? mine + direction : other.position;
        try {
          await patchModule(other.id, { position: mine });
          set({ states: await patchModule(id, { position: theirs }) });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : "Couldn't move" });
          void get().load({ force: true });
        }
      },
    }),
    {
      name: "modules-store",
      storage: ssrSafeJsonStorage,
      partialize: (state) => ({ states: state.states }),
      // A cache from an earlier visit is a real answer; the defaults aren't.
      // It goes back through resolveModuleStates so a module this build no
      // longer ships drops out and a new one appears at its default.
      merge: (persisted, current) => {
        const cached = (persisted as { states?: ModuleState[] } | undefined)
          ?.states;
        if (!Array.isArray(cached)) return current;
        return {
          ...current,
          known: true,
          states: resolveModuleStates(
            cached.map((s) => ({
              moduleId: s.id,
              enabled: s.on,
              position: s.position,
            }))
          ),
        };
      },
    }
  )
);

/** The modules this person has on, in rail order. Empty until it's known. */
export function useOnModules(): ModuleManifest[] {
  const states = useModulesStore((s) => s.states);
  const known = useModulesStore((s) => s.known);
  return useMemo(
    () =>
      known ? states.filter((s) => s.on).map((s) => moduleById(s.id)) : [],
    [states, known]
  );
}

/** Whether a module is on: true or false once known, null before. */
export function useModuleOn(id: ModuleId): boolean | null {
  const known = useModulesStore((s) => s.known);
  const on = useModulesStore(
    (s) => s.states.find((m) => m.id === id)?.on ?? false
  );
  return known ? on : null;
}
