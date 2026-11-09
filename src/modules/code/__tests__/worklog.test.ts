import { planLinks, claimKeys } from "@/lib/sigwald/goal-rules";

import { repoClaimKeys } from "@/modules/code/facts";
import {
  CODE_SOURCE,
  importWorkDays,
  parseWorkDays,
  workDayKey,
  workDayText,
  type WorkDay,
} from "@/modules/code/worklog";

const mahoraga = {
  repo: "pockanoodles/Mahoraga",
  label: "Mahoraga",
  day: "2026-11-07",
  commits: 3,
  subjects: ["fix(router): retry once", "feat: voice", "chore: bump"],
  lastAt: "2026-11-07T23:41:00-05:00",
  url: "https://github.com/pockanoodles/Mahoraga",
};

const parsed = (days: unknown[]): WorkDay[] => {
  const result = parseWorkDays({ days });
  if (typeof result === "string") throw new Error(result);
  return result;
};

describe("parseWorkDays", () => {
  it("lowercases the repo, since claims match it exactly", () => {
    const [day] = parsed([mahoraga]);
    expect(day.repo).toBe("pockanoodles/mahoraga");
    expect(day.label).toBe("Mahoraga");
    expect(day.lastAt.toISOString()).toBe("2026-11-08T04:41:00.000Z");
  });

  it("falls back to the repo when no label is sent", () => {
    const [day] = parsed([{ ...mahoraga, label: undefined }]);
    expect(day.label).toBe("pockanoodles/mahoraga");
  });

  it("rejects a time without its offset, a bad day and a zero count", () => {
    expect(parseWorkDays({ days: [{ ...mahoraga, lastAt: "2026-11-07T23:41:00" }] })).toMatch(/offset/);
    expect(parseWorkDays({ days: [{ ...mahoraga, day: "11/07/2026" }] })).toMatch(/YYYY-MM-DD/);
    expect(parseWorkDays({ days: [{ ...mahoraga, commits: 0 }] })).toMatch(/above 0/);
  });

  it("rejects a repo that isn't owner/name and a link that isn't https", () => {
    expect(parseWorkDays({ days: [{ ...mahoraga, repo: "Mahoraga" }] })).toMatch(/owner\/name/);
    expect(parseWorkDays({ days: [{ ...mahoraga, url: "http://example.com" }] })).toMatch(/https/);
  });

  it("refuses the same repo and day twice in one body", () => {
    expect(parseWorkDays({ days: [mahoraga, { ...mahoraga, repo: "POCKANOODLES/mahoraga" }] })).toMatch(
      /repeats pockanoodles\/mahoraga@2026-11-07/
    );
  });

  it("accepts an empty list", () => {
    expect(parseWorkDays({ days: [] })).toEqual([]);
  });
});

describe("workDayText", () => {
  it("names the repo and the count, and lists the messages", () => {
    const [day] = parsed([mahoraga]);
    expect(workDayText(day)).toEqual({
      title: "Mahoraga · 3 commits",
      description: "- fix(router): retry once\n- feat: voice\n- chore: bump",
    });
  });

  it("says how many messages it left out", () => {
    const [day] = parsed([{ ...mahoraga, commits: 5, subjects: ["one", "two"] }]);
    expect(workDayText(day).description).toBe("- one\n- two\n- and 3 more");
    const [single] = parsed([{ ...mahoraga, commits: 1, subjects: [] }]);
    expect(workDayText(single)).toEqual({ title: "Mahoraga · 1 commit", description: null });
  });
});

/** Just enough of Prisma's task table for the import. */
function fakeDb(rows: Record<string, unknown>[] = []) {
  const tasks = rows.map((row) => ({ ...row }));
  let next = tasks.length;
  return {
    tasks,
    task: {
      findMany: async ({ where }: { where: { externalTaskId: { in: string[] } } }) =>
        tasks.filter((t) => t.source === CODE_SOURCE && where.externalTaskId.in.includes(t.externalTaskId as string)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const task = { id: `t${++next}`, ...data };
        tasks.push(task);
        return { id: task.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(tasks.find((t) => t.id === where.id)!, data);
      },
    },
  };
}

describe("importWorkDays", () => {
  it("makes one finished task per repo and day, and leaves an unchanged day alone", async () => {
    const db = fakeDb();
    const days = parsed([mahoraga, { ...mahoraga, day: "2026-11-06", lastAt: "2026-11-06T10:00:00-05:00" }]);
    const first = await importWorkDays(db as never, "user", days);
    expect(first).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(db.tasks[0]).toMatchObject({
      source: CODE_SOURCE,
      externalTaskId: "pockanoodles/mahoraga@2026-11-07",
      externalListId: "pockanoodles/mahoraga",
      status: "completed",
      title: "Mahoraga · 3 commits",
      userId: "user",
    });
    expect((db.tasks[0].completedAt as Date).toISOString()).toBe("2026-11-08T04:41:00.000Z");

    const again = await importWorkDays(db as never, "user", days);
    expect(again).toEqual({ changed: [], created: 0, updated: 0, unchanged: 2 });
  });

  it("writes over a day that grew, and finishes it again if it was reopened", async () => {
    const db = fakeDb();
    await importWorkDays(db as never, "user", parsed([mahoraga]));
    db.tasks[0].status = "todo";
    const grown = parsed([{ ...mahoraga, commits: 4, subjects: ["docs: readme", ...mahoraga.subjects] }]);
    const result = await importWorkDays(db as never, "user", grown);
    expect(result).toMatchObject({ created: 0, updated: 1, changed: [db.tasks[0].id] });
    expect(db.tasks[0]).toMatchObject({ title: "Mahoraga · 4 commits", status: "completed" });
    expect(db.tasks).toHaveLength(1);
  });
});

describe("claims", () => {
  it("lets a goal claim a repo or everything under its owner", () => {
    expect(repoClaimKeys("course-tutor/core")).toEqual(["repo:course-tutor/core", "owner:course-tutor"]);
    // A repo with no remote has no owner to claim.
    expect(repoClaimKeys("local/scratch")).toEqual(["repo:local/scratch"]);
  });

  it("files a repo's day under the goal that claims its owner", () => {
    const task = {
      id: "day",
      source: CODE_SOURCE,
      claims: repoClaimKeys("course-tutor/core"),
      projectId: null,
      status: "completed",
      goalLinks: [],
    };
    expect(claimKeys(task)).toContain("owner:course-tutor");
    const goals = [
      { id: "ct", externalId: "venture:course-tutor", isBoss: false, status: "active", taskSources: ["owner:course-tutor"] },
      { id: "school", externalId: "venture:school-f25", isBoss: false, status: "active", taskSources: ["CANVAS"] },
    ];
    expect(planLinks(goals, new Map(), [task])).toEqual({ create: [{ taskId: "day", goalId: "ct" }], stale: [] });
  });
});

it("keys a day by its repo and date", () => {
  expect(workDayKey({ repo: "pockanoodles/sigwald", day: "2026-11-08" })).toBe("pockanoodles/sigwald@2026-11-08");
});
