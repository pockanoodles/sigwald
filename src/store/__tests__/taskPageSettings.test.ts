import { useTaskPageSettings } from "@/store/taskPageSettings";

describe("task page settings migration", () => {
  const migrate = useTaskPageSettings.persist.getOptions().migrate!;

  it("opens a saved List as the sheet, now that Rows is gone", async () => {
    expect(await migrate({ viewMode: "list", listStyle: "rows" }, 0)).toEqual({
      viewMode: "sheet",
    });
  });

  it("keeps a saved Board", async () => {
    expect(await migrate({ viewMode: "board", listStyle: "sheet" }, 0)).toEqual(
      {
        viewMode: "board",
      }
    );
  });
});
