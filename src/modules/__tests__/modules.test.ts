import {
  MODULES,
  hiddenSourcesOf,
  isModuleId,
  moduleForPath,
  moduleForSource,
  nextPosition,
  resolveModuleStates,
  sourceClaims,
} from "@/modules";

describe("resolveModuleStates", () => {
  it("lists finished modules before the ones in beta", () => {
    const ids = MODULES.map((m) => m.id);
    expect(ids).toEqual([
      "ladder",
      "work",
      "courses",
      "people",
      "training",
      "nutrition",
      "code",
    ]);
    const firstBeta = MODULES.findIndex((m) => m.beta);
    expect(MODULES.slice(firstBeta).every((m) => m.beta)).toBe(true);
  });

  it("gives a module nobody touched its default and its catalog place", () => {
    const states = resolveModuleStates([]);
    expect(states.map((s) => s.id)).toEqual(MODULES.map((m) => m.id));
    // A new install starts with every module off (Stats too, since 1.0).
    expect(states.every((s) => !s.on)).toBe(true);
  });

  it("lets a row override the default and order the rail", () => {
    const states = resolveModuleStates([
      { moduleId: "ladder", enabled: false, position: 0 },
      { moduleId: "courses", enabled: true, position: 5 },
    ]);
    expect(states).toEqual([
      { id: "ladder", on: false, position: 0 },
      { id: "work", on: false, position: 1 },
      { id: "people", on: false, position: 3 },
      { id: "training", on: false, position: 4 },
      { id: "courses", on: true, position: 5 },
      { id: "nutrition", on: false, position: 5 },
      { id: "code", on: false, position: 6 },
    ]);
  });

  it("ignores rows for modules this build doesn't ship", () => {
    const states = resolveModuleStates([
      { moduleId: "gone", enabled: true, position: 0 },
    ]);
    expect(states.map((s) => s.id)).not.toContain("gone");
  });

  it("breaks a tie in position by catalog order", () => {
    const states = resolveModuleStates([
      { moduleId: "courses", enabled: true, position: 0 },
      { moduleId: "ladder", enabled: true, position: 0 },
    ]);
    expect(states.map((s) => s.id)).toEqual([
      "ladder",
      "courses",
      "work",
      "people",
      "training",
      "nutrition",
      "code",
    ]);
  });
});

describe("hiddenSourcesOf", () => {
  it("hides each module's tasks only while it's off", () => {
    expect(hiddenSourcesOf(resolveModuleStates([]))).toEqual([
      "WORK",
      "CANVAS",
      "PEOPLE",
      "TRAINING",
      "CODE",
    ]);
    expect(
      hiddenSourcesOf(
        resolveModuleStates([
          { moduleId: "courses", enabled: true, position: 0 },
          { moduleId: "people", enabled: true, position: 1 },
          { moduleId: "training", enabled: true, position: 2 },
          { moduleId: "work", enabled: true, position: 3 },
          { moduleId: "code", enabled: true, position: 4 },
        ])
      )
    ).toEqual([]);
  });
});

describe("lookups", () => {
  it("finds a module by its page, including the page's own paths", () => {
    expect(moduleForPath("/courses")?.id).toBe("courses");
    expect(moduleForPath("/goals/x")?.id).toBe("ladder");
    expect(moduleForPath("/coursesx")).toBeUndefined();
    expect(moduleForPath("/tasks")).toBeUndefined();
  });

  it("finds the module that owns a task source", () => {
    expect(moduleForSource("CANVAS")?.id).toBe("courses");
    expect(moduleForSource("GOOGLE")).toBeUndefined();
    expect(moduleForSource(null)).toBeUndefined();
  });

  it("knows its own ids", () => {
    expect(isModuleId("courses")).toBe(true);
    expect(isModuleId("settings")).toBe(false);
  });

  it("puts a module turned on after everything already in the rail", () => {
    expect(nextPosition([])).toBe(0);
    expect(
      nextPosition([
        { id: "courses", on: true, position: 0 },
        { id: "ladder", on: true, position: 3 },
      ])
    ).toBe(4);
  });
});

describe("sourceClaims", () => {
  it("offers goals each whole source a module labels, and only those", () => {
    const claims = sourceClaims();
    expect(claims.map((c) => c.key)).toEqual(
      MODULES.flatMap((m) => Object.keys(m.claimLabels ?? {}))
    );
    expect(claims.find((c) => c.key === "CANVAS")?.label).toBe(
      "All Canvas work"
    );
  });
});
