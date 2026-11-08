import type { Db } from "@/lib/prisma";
import { searchEverything } from "@/lib/search/search";
import type { SearchGroup } from "@/lib/search/types";

const group = (id: string, ...ranks: number[]): SearchGroup => ({
  id,
  label: id,
  hits: ranks.map((rank, i) => ({
    id: `${id}${i}`,
    title: id,
    href: "/",
    rank,
  })),
});

let found: { tasks: SearchGroup; events: SearchGroup; modules: SearchGroup[] };

jest.mock("@/lib/search/core", () => ({
  searchTasks: jest.fn(async () => found.tasks),
  searchEvents: jest.fn(async () => found.events),
}));
jest.mock("@/modules/hooks", () => ({
  moduleSearch: jest.fn(async () => found.modules),
}));
jest.mock("@/modules/state", () => ({
  moduleView: jest.fn(async () => ({ hidden: [], isOn: () => true })),
}));

const db = {
  userSettings: {
    findUnique: jest.fn(async () => ({
      timeZone: "America/New_York",
      timeFormat: "12h",
    })),
  },
} as unknown as Db;

describe("searchEverything", () => {
  it("puts the group with the best match first, and drops empty ones", async () => {
    found = {
      // Found only in notes.
      tasks: group("tasks", 4, 4),
      events: group("events"),
      // A goal with the word in its title.
      modules: [group("goals", 2), group("people", 4)],
    };
    const groups = await searchEverything(db, "u", "offer");
    expect(groups.map((g) => g.id)).toEqual(["goals", "tasks", "people"]);
  });

  it("ranks name matches as one tier, so tasks keep their lead over a closer-named PDF", async () => {
    found = {
      // "Assignment 8 (Netflix)": a word in the name.
      tasks: group("tasks", 2),
      events: group("events"),
      // "Netflix: Streaming Away…": the name starts with it.
      modules: [group("materials", 1)],
    };
    const groups = await searchEverything(db, "u", "netflix");
    expect(groups.map((g) => g.id)).toEqual(["tasks", "materials"]);
  });

  it("lets a whole-name match lead", async () => {
    found = {
      tasks: group("tasks", 2),
      events: group("events"),
      modules: [group("people", 0)],
    };
    const groups = await searchEverything(db, "u", "ana");
    expect(groups.map((g) => g.id)).toEqual(["people", "tasks"]);
  });

  it("keeps the core's groups ahead on a tie", async () => {
    found = {
      tasks: group("tasks", 1),
      events: group("events", 1),
      modules: [group("people", 1)],
    };
    const groups = await searchEverything(db, "u", "ana");
    expect(groups.map((g) => g.id)).toEqual(["tasks", "events", "people"]);
  });
});
