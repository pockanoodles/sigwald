import {
  applySettingsChange,
  missingSettings,
  resolveSettings,
} from "@/modules/connect/settings";
import { type SettingField, maxOpenField } from "@/modules/connect/spec";

const fields: SettingField[] = [
  {
    kind: "text",
    key: "database",
    label: "Database",
    pattern: { source: "[a-f0-9]{8}", message: "an id" },
  },
  { kind: "text", key: "note", label: "Note", optional: true },
  {
    kind: "list",
    key: "repos",
    label: "Repos",
    optional: true,
    itemPattern: { source: "\\w+/\\w+", message: "owner/name" },
  },
  { kind: "toggle", key: "reviews", label: "Reviews", default: true },
  {
    kind: "select",
    key: "mode",
    label: "Mode",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    default: "a",
  },
  maxOpenField(25),
];

describe("resolveSettings", () => {
  it("fills defaults and drops stored values that no longer fit", () => {
    expect(
      resolveSettings(fields, {
        reviews: false,
        mode: "zzz",
        maxOpen: 999,
        stray: 1,
      })
    ).toEqual({
      database: "",
      note: "",
      repos: [],
      reviews: false,
      mode: "a",
      maxOpen: 25,
    });
  });
});

describe("missingSettings", () => {
  it("names required fields that are still empty", () => {
    expect(missingSettings(fields, resolveSettings(fields, {}))).toEqual([
      "Database",
    ]);
    expect(
      missingSettings(fields, resolveSettings(fields, { database: "abcdef12" }))
    ).toEqual([]);
  });
});

describe("applySettingsChange", () => {
  it("checks each value against its field and keeps the rest", () => {
    const stored = { database: "abcdef12", reviews: false };
    expect(
      applySettingsChange(fields, stored, {
        repos: "a/b\nc/d, a/b",
        maxOpen: "40",
      })
    ).toEqual({
      settings: {
        database: "abcdef12",
        note: "",
        repos: ["a/b", "c/d"],
        reviews: false,
        mode: "a",
        maxOpen: 40,
      },
    });
  });

  it("says what's wrong with a value that doesn't fit", () => {
    expect(applySettingsChange(fields, {}, { database: "nope" })).toEqual({
      problem: "Database: an id",
    });
    expect(applySettingsChange(fields, {}, { repos: ["bad"] })).toEqual({
      problem: "Repos: bad: owner/name",
    });
    expect(applySettingsChange(fields, {}, { maxOpen: 0 })).toEqual({
      problem: "Most open at once: must be from 1 to 200",
    });
    expect(applySettingsChange(fields, {}, { nope: 1 })).toEqual({
      problem: "There's no setting called nope",
    });
    expect(applySettingsChange(fields, {}, { reviews: "yes" })).toEqual({
      problem: "Reviews: must be on or off",
    });
  });
});
