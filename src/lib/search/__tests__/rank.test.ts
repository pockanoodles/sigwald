import {
  OTHER_FIELD_RANK,
  matchRank,
  nameRank,
  topByKeys,
} from "@/lib/search/rank";

describe("nameRank", () => {
  it("orders whole name, start, word start, then anywhere", () => {
    expect(nameRank("Netflix", "netflix")).toBe(0);
    expect(nameRank("Netflix case", "netf")).toBe(1);
    expect(nameRank("Assignment 8 (Netflix)", "netf")).toBe(2);
    expect(nameRank("Module 10 Discussion", "cuss")).toBe(3);
  });

  it("is null when the name doesn't hold the text", () => {
    expect(nameRank("Netflix", "walmart")).toBeNull();
    expect(nameRank(null, "x")).toBeNull();
  });

  it("treats accented letters as letters, not word breaks", () => {
    expect(nameRank("Café menu", "fé")).toBe(3);
  });
});

describe("matchRank", () => {
  it("puts a match in another field below every name match", () => {
    expect(matchRank("Lunch with Ana", "notes only")).toBe(OTHER_FIELD_RANK);
    expect(matchRank("Ana", "an")).toBeLessThan(OTHER_FIELD_RANK);
  });
});

describe("topByKeys", () => {
  it("compares keys left to right and keeps ties in arrival order", () => {
    const rows = ["c", "a", "b", "d"];
    const keys: Record<string, number[]> = {
      a: [1, 5],
      b: [1, 2],
      c: [0, 9],
      d: [1, 2],
    };
    expect(topByKeys(rows, (r) => keys[r], 3)).toEqual(["c", "b", "d"]);
  });
});
