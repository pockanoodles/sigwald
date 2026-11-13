import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { courseFolderAlias } from "../canvas/material-files";
import { buildMaterialManifest } from "../canvas/material-manifest";

describe("courseFolderAlias", () => {
  it("keeps the subject and number of a Canvas course code", () => {
    expect(courseFolderAlias("MISM2301.10244.202710")).toBe("MISM2301");
    expect(courseFolderAlias("INTB 1203.MERGED.202710")).toBe("INTB1203");
    expect(courseFolderAlias("Fall advising")).toBeNull();
    expect(courseFolderAlias(null)).toBeNull();
  });
});

describe("buildMaterialManifest", () => {
  let root: string;
  const previous = process.env.SIGWALD_MATERIALS_DIR;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "sigwald-manifest-"));
    process.env.SIGWALD_MATERIALS_DIR = root;
    await mkdir(path.join(root, "265615"), { recursive: true });
    await writeFile(path.join(root, "265615", "101-ERP.pptx"), "12345");
  });

  afterEach(async () => {
    process.env.SIGWALD_MATERIALS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  const material = (over: Partial<{ id: string; fileCanvasId: string | null; localPath: string | null }>) => ({
    id: "m1",
    fileCanvasId: "101",
    fileName: "ERP.pptx",
    fileUpdatedAt: new Date("2026-11-03T12:00:00Z"),
    localPath: path.join(root, "265615", "101-ERP.pptx"),
    ...over,
  });

  it("lists each cached item by its path inside the cache, with the size on disk", async () => {
    const manifest = await buildMaterialManifest([
      {
        canvasId: "265615",
        code: "MISM2301.10244.202710",
        // The same file in two modules is two items, both fetchable.
        materials: [material({ id: "m1" }), material({ id: "m2" })],
      },
    ]);
    expect(manifest.courses).toEqual([{ canvasId: "265615", code: "MISM2301.10244.202710", alias: "MISM2301" }]);
    expect(manifest.files).toEqual(
      ["m1", "m2"].map((materialId) => ({
        materialId,
        courseCanvasId: "265615",
        fileCanvasId: "101",
        fileName: "ERP.pptx",
        path: "265615/101-ERP.pptx",
        sizeBytes: 5,
        fileUpdatedAt: "2026-11-03T12:00:00.000Z",
      }))
    );
  });

  it("leaves out what the file route couldn't serve", async () => {
    const manifest = await buildMaterialManifest([
      {
        canvasId: "265615",
        code: null,
        materials: [
          material({ id: "gone", localPath: path.join(root, "265615", "102-gone.pdf") }),
          material({ id: "outside", localPath: path.join(os.tmpdir(), "elsewhere.pdf") }),
          material({ id: "escape", localPath: path.join(root, "..", "x.pdf") }),
          material({ id: "uncached", localPath: null }),
          material({ id: "no-file-id", fileCanvasId: null }),
        ],
      },
    ]);
    expect(manifest.files).toEqual([]);
    expect(manifest.courses[0].alias).toBeNull();
  });
});
