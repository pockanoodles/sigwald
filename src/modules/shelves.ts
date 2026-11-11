/**
 * The marketplace's shelves, in the order its Shelf menu lists them. Plain
 * data, safe anywhere.
 */
import type { ModuleShelf } from "@/modules/types";

export interface Shelf {
  id: ModuleShelf;
  name: string;
}

export const SHELVES: readonly Shelf[] = [
  { id: "goals", name: "Goals & numbers" },
  { id: "engineering", name: "Engineering" },
  { id: "projects", name: "Projects" },
  { id: "creative", name: "Design & media" },
  { id: "writing", name: "Writing" },
  { id: "research", name: "Research" },
  { id: "clients", name: "Clients" },
  { id: "money", name: "Money & hours" },
  { id: "learning", name: "Learning" },
  { id: "health", name: "Health" },
  { id: "people", name: "People & career" },
  { id: "calendar", name: "Calendar & place" },
  { id: "anything", name: "Bring your own" },
];

export function shelfName(id: ModuleShelf): string {
  return SHELVES.find((s) => s.id === id)?.name ?? id;
}
