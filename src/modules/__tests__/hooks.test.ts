import type { Db } from "@/lib/prisma";

import {
  moduleClaimKeys,
  moduleRankSignals,
  moduleSearch,
  moduleTaskFacts,
} from "@/modules/hooks";
import type { FactsRequest } from "@/modules/server";
import type { ModuleId } from "@/modules/types";

// Stand-in contributions, so these tests pin the merging, not the modules.
// Any module not named here contributes nothing.
jest.mock("@/modules/server", () => ({
  SERVER_MODULES: new Proxy(
    {
      courses: {
        taskFacts: jest.fn(
          async (_db: unknown, _user: string, tasks: FactsRequest[]) =>
            new Map(
              tasks.map((t) => [
                t.id,
                { courseName: "MKTG", projected: Boolean(t.danger) },
              ])
            )
        ),
        claimKeys: jest.fn(
          async (_db: unknown, _user: string, ids: string[]) =>
            new Map(ids.map((id) => [id, [`course:${id}`]]))
        ),
        rankSignals: jest.fn(
          async () => new Map([["a", { stakes: 100, stakesGroup: "c1" }]])
        ),
        search: jest.fn(async () => [
          { id: "courses", label: "Courses", hits: [] },
          { id: "materials", label: "Materials", hits: [] },
        ]),
      },
      ladder: {
        taskFacts: jest.fn(
          async () => new Map([["a", { ladderGoals: ["g"] }]])
        ),
        rankSignals: jest.fn(
          async () =>
            new Map([
              ["a", { lift: 0.4 }],
              ["b", { lift: 0.9 }],
            ])
        ),
        claimKeys: jest.fn(async () => new Map([["a", ["venture:x"]]])),
        search: jest.fn(async () => {
          throw new Error("goals table on fire");
        }),
      },
      people: {
        search: jest.fn(async () => [
          { id: "people", label: "People", hits: [] },
        ]),
        rankSignals: jest.fn(
          async () =>
            new Map([
              ["a", { lift: 0.7 }],
              ["b", { lift: 0.2 }],
            ])
        ),
      },
    } as Record<string, unknown>,
    { get: (named, id: string) => named[id] ?? {} }
  ),
}));

const db = {} as Db;
const on =
  (...ids: ModuleId[]) =>
  (id: ModuleId) =>
    ids.includes(id);

describe("moduleTaskFacts", () => {
  it("merges what each module that's on adds, per task", async () => {
    const facts = await moduleTaskFacts(
      db,
      "u",
      [{ id: "a", danger: true }, { id: "b" }],
      on("courses", "ladder")
    );
    expect(facts.get("a")).toEqual({
      courseName: "MKTG",
      projected: true,
      ladderGoals: ["g"],
    });
    expect(facts.get("b")).toEqual({ courseName: "MKTG", projected: false });
  });

  it("never asks a module that's off", async () => {
    const facts = await moduleTaskFacts(db, "u", [{ id: "a" }], on("ladder"));
    expect(facts.get("a")).toEqual({ ladderGoals: ["g"] });
  });

  it("asks nothing for no tasks", async () => {
    expect((await moduleTaskFacts(db, "u", [], on("courses"))).size).toBe(0);
  });
});

describe("moduleRankSignals", () => {
  it("keeps the strongest lift, and the owner's stakes", async () => {
    const signals = await moduleRankSignals(
      db,
      "u",
      ["a", "b"],
      on("courses", "ladder", "people")
    );
    expect(signals.get("a")).toEqual({
      lift: 0.7,
      stakes: 100,
      stakesGroup: "c1",
    });
    expect(signals.get("b")).toEqual({ lift: 0.9 });
  });

  it("leaves out a module that's off", async () => {
    const signals = await moduleRankSignals(db, "u", ["a", "b"], on("people"));
    expect(signals.get("a")).toEqual({ lift: 0.7 });
    expect(signals.get("b")).toEqual({ lift: 0.2 });
  });
});

describe("moduleClaimKeys", () => {
  it("asks every module, on or off, and keeps every key", async () => {
    const keys = await moduleClaimKeys(db, "u", ["a", "b"]);
    expect(keys.get("a")).toEqual(["venture:x", "course:a"]);
    expect(keys.get("b")).toEqual(["course:b"]);
  });
});

describe("moduleSearch", () => {
  const q = {
    text: "ana",
    now: new Date(),
    timeZone: "UTC",
    timeFormat: "12h" as const,
  };

  it("asks only the modules that are on, in catalog order", async () => {
    const groups = await moduleSearch(db, "u", q, on("people", "courses"));
    expect(groups.map((g) => g.id)).toEqual(["courses", "materials", "people"]);
  });

  it("leaves out a module whose search fails instead of failing the rest", async () => {
    const groups = await moduleSearch(db, "u", q, on("ladder", "people"));
    expect(groups.map((g) => g.id)).toEqual(["people"]);
  });
});
