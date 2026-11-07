import { Prisma } from "@prisma/client";

import {
  MODEL_SPECS,
  exportedModels,
  ownerFilter,
} from "@/lib/account-export/models";

describe("account-export model classification", () => {
  const dmmfNames = Prisma.dmmf.datamodel.models.map((m) => m.name);

  it("classifies every dmmf model exactly once", () => {
    const classified = Object.keys(MODEL_SPECS);
    expect(classified.sort()).toEqual([...dmmfNames].sort());
  });

  it("gives every include/strip model an owner filter", () => {
    for (const name of exportedModels()) {
      const where = ownerFilter(name, "user-1");
      expect(where).toEqual(expect.any(Object));
      expect(Object.keys(where).length).toBeGreaterThan(0);
    }
  });

  it("only strips fields that exist on the model", () => {
    for (const [name, spec] of Object.entries(MODEL_SPECS)) {
      if (spec.class !== "strip") continue;
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
      expect(model).toBeDefined();
      const scalars = new Set(
        model!.fields.filter((f) => f.kind === "scalar").map((f) => f.name)
      );
      for (const field of Object.keys(spec.fields)) {
        expect(scalars.has(field)).toBe(true);
      }
    }
  });
});
