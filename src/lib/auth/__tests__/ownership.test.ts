import { findForeignRef, foreignRefMessage } from "@/lib/auth/ownership";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: { count: jest.fn() },
    tag: { count: jest.fn() },
    goal: { count: jest.fn() },
    connectedAccount: { count: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  jest.clearAllMocks();
  db.project.count.mockResolvedValue(1);
  db.tag.count.mockResolvedValue(0);
  db.goal.count.mockResolvedValue(1);
  db.connectedAccount.count.mockResolvedValue(1);
});

describe("findForeignRef", () => {
  it("skips absent references without querying", async () => {
    await expect(
      findForeignRef("u1", { projectId: null, tagIds: [], goalId: undefined })
    ).resolves.toBeNull();
    expect(db.project.count).not.toHaveBeenCalled();
    expect(db.tag.count).not.toHaveBeenCalled();
    expect(db.goal.count).not.toHaveBeenCalled();
  });

  it("scopes every lookup to the caller", async () => {
    db.tag.count.mockResolvedValue(2);
    await findForeignRef("u1", {
      projectId: "p1",
      tagIds: ["t1", "t2"],
      goalId: "g1",
      accountId: "a1",
    });
    expect(db.project.count).toHaveBeenCalledWith({
      where: { id: "p1", userId: "u1" },
    });
    expect(db.tag.count).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, userId: "u1" },
    });
    expect(db.goal.count).toHaveBeenCalledWith({
      where: { id: "g1", userId: "u1" },
    });
    expect(db.connectedAccount.count).toHaveBeenCalledWith({
      where: { id: "a1", userId: "u1" },
    });
  });

  it("names a project that isn't the caller's", async () => {
    db.project.count.mockResolvedValue(0);
    await expect(findForeignRef("u1", { projectId: "p2" })).resolves.toBe(
      "projectId"
    );
  });

  it("flags tags when any one of them isn't the caller's", async () => {
    db.tag.count.mockResolvedValue(1);
    await expect(
      findForeignRef("u1", { tagIds: ["mine", "theirs"] })
    ).resolves.toBe("tagIds");
  });

  it("counts a repeated tag id once", async () => {
    db.tag.count.mockResolvedValue(1);
    await expect(
      findForeignRef("u1", { tagIds: ["t1", "t1"] })
    ).resolves.toBeNull();
  });

  it("names a goal or account that isn't the caller's", async () => {
    db.goal.count.mockResolvedValue(0);
    await expect(findForeignRef("u1", { goalId: "g2" })).resolves.toBe(
      "goalId"
    );
    db.goal.count.mockResolvedValue(1);
    db.connectedAccount.count.mockResolvedValue(0);
    await expect(findForeignRef("u1", { accountId: "a2" })).resolves.toBe(
      "accountId"
    );
  });

  it("reads as not found, not forbidden", () => {
    expect(foreignRefMessage("projectId")).toBe("Project not found");
  });
});
