import { Prisma } from "@prisma/client";

import {
  SELF_RELATION_FIELDS,
  exportedModels,
} from "@/lib/account-export/models";
import {
  eraseOrder,
  insertOrder,
  selfRelationFields,
} from "@/lib/account-export/order";

describe("account-export insert order", () => {
  it("places parents before children for every non-self relation", () => {
    const order = insertOrder();
    const index = new Map(order.map((name, i) => [name, i]));
    const set = new Set(exportedModels());

    for (const entry of Prisma.dmmf.datamodel.models) {
      if (!set.has(entry.name)) continue;
      const selfField = SELF_RELATION_FIELDS[entry.name];
      for (const field of entry.fields) {
        if (field.kind !== "object") continue;
        const from = field.relationFromFields ?? [];
        if (from.length === 0) continue;
        if (selfField && from.includes(selfField)) continue;
        if (field.type === entry.name) continue;
        if (!set.has(field.type)) continue;
        expect(index.get(field.type)!).toBeLessThan(index.get(entry.name)!);
      }
    }
  });

  it("excludes self-relations from the sort dependencies", () => {
    const fields = selfRelationFields();
    expect(fields.Task).toBe("parentTaskId");
    expect(fields.CalendarEvent).toBe("masterEventId");
    expect(fields.CourseMaterial).toBe("parentId");

    // A self-edge must not force a model after itself.
    const order = insertOrder();
    expect(order).toContain("Task");
    expect(new Set(order).size).toBe(order.length);
  });

  it("erase order is the reverse of insert order", () => {
    expect(eraseOrder()).toEqual(insertOrder().slice().reverse());
  });
});
