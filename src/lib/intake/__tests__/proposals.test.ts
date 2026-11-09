import {
  decide,
  findDuplicate,
  parseProposals,
  titleWords,
  type KnownWork,
  type ProposalInput,
} from "@/lib/intake/proposals";

const NOW = new Date("2026-11-09T15:00:00.000Z");
const at = (iso: string) => new Date(iso);

const proposal = (overrides: Partial<ProposalInput> = {}): ProposalInput => ({
  ref: "canvas-announcement:a1#0",
  title: "Read chapter 9 and answer the DQ",
  dueAt: at("2026-11-13T13:00:00.000Z"), // Friday 8:00 EST
  duration: 60,
  evidence: "Finish reading Chapter 9 and answer DQ before Friday's class (Due Friday 8:00am)",
  dueText: "Due Friday 8:00am",
  sourceLabel: "MISM2301 announcement: Reading plan",
  sourceUrl: "https://northeastern.instructure.com/courses/1/discussion_topics/2",
  claims: ["CANVAS", "course:1"],
  trusted: true,
  optional: false,
  grounded: true,
  ...overrides,
});

describe("titleWords", () => {
  it("keeps the words that name the work, numbers included", () => {
    expect([...titleWords("Read Chapter 9 and answer the DQ")]).toEqual(["chapter", "9", "answer", "dq"]);
  });
});

describe("findDuplicate", () => {
  it("matches the assignment due at the same moment that shares a word", () => {
    const known: KnownWork[] = [
      { taskId: "dq", title: "Chap 9 DQ", dueAt: at("2026-11-13T13:00:00.000Z") },
      { taskId: "quiz", title: "Quiz 4", dueAt: at("2026-11-13T13:00:00.000Z") },
    ];
    expect(findDuplicate(proposal(), known)?.taskId).toBe("dq");
  });

  it("matches the same day under much the same name", () => {
    const known: KnownWork[] = [{ taskId: "t2", title: "Study for Test 2", dueAt: at("2026-11-13T04:59:00.000Z") }];
    expect(findDuplicate(proposal({ title: "Study for test 2" }), known)?.taskId).toBe("t2");
  });

  it("doesn't call different work at the same time a duplicate", () => {
    const known: KnownWork[] = [{ taskId: "other", title: "Module 11 Discussion Board", dueAt: at("2026-11-13T13:00:00.000Z") }];
    expect(findDuplicate(proposal(), known)).toBeNull();
  });

  it("picks the closest name when several are due together", () => {
    const due = at("2026-11-14T04:59:00.000Z");
    const known: KnownWork[] = [
      { taskId: "hw", title: "Module 11 Homework Assignment", dueAt: due },
      { taskId: "board", title: "Module 11 Discussion Board", dueAt: due },
    ];
    expect(findDuplicate(proposal({ title: "Post on the Module 11 discussion board", dueAt: due }), known)?.taskId).toBe("board");
  });
});

describe("decide", () => {
  it("makes a trusted, grounded, required proposal a task on its own", () => {
    expect(decide(proposal(), [], NOW)).toEqual({ status: "accepted" });
  });

  it("holds anything less for the person", () => {
    expect(decide(proposal({ trusted: false }), [], NOW)).toEqual({ status: "pending" });
    expect(decide(proposal({ grounded: false }), [], NOW)).toEqual({ status: "pending" });
    expect(decide(proposal({ optional: true }), [], NOW)).toEqual({ status: "pending" });
  });

  it("dismisses a deadline already past, and matches work Sigwald has before anything else", () => {
    expect(decide(proposal({ dueAt: at("2026-11-08T13:00:00.000Z") }), [], NOW)).toEqual({ status: "dismissed" });
    const known: KnownWork[] = [{ taskId: null, title: "Read chapter 9, answer the DQ", dueAt: at("2026-11-13T13:00:00.000Z") }];
    expect(decide(proposal(), known, NOW)).toEqual({ status: "duplicate", taskId: null });
  });
});

describe("parseProposals", () => {
  const wire = (overrides: Record<string, unknown> = {}) => ({
    ...proposal(),
    dueAt: "2026-11-13T08:00:00-05:00",
    ...overrides,
  });

  it("reads a proposal and its instant", () => {
    const parsed = parseProposals({ proposals: [wire()] });
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed[0].dueAt.toISOString()).toBe("2026-11-13T13:00:00.000Z");
    expect(parsed[0].claims).toEqual(["CANVAS", "course:1"]);
  });

  it("refuses what it can't trust", () => {
    expect(parseProposals({ proposals: [wire({ dueAt: "2026-11-13T08:00:00" })] })).toMatch(/offset/);
    expect(parseProposals({ proposals: [wire({ evidence: "" })] })).toMatch(/evidence/);
    expect(parseProposals({ proposals: [wire({ grounded: "yes" })] })).toMatch(/grounded/);
    expect(parseProposals({ proposals: [wire(), wire()] })).toMatch(/repeats/);
    expect(parseProposals({ proposals: [wire({ sourceUrl: "http://x" })] })).toMatch(/https/);
  });
});
