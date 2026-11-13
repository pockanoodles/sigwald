/**
 * What the materials cache holds, for a copy kept somewhere else (ops mirrors
 * it to the Mac, where the school sessions read it). Each cached file is named
 * by its path inside the cache root, so the copy reproduces Sigwald's own
 * layout (`<course id>/<file id>-<name>`, plus the course-code aliases) and
 * never has to know how Sigwald names things.
 */
import { stat } from "node:fs/promises";
import path from "node:path";

import { courseFolderAlias, isInsideMaterialsRoot, materialsRoot } from "@/lib/canvas/material-files";

export interface ManifestCourseRow {
  canvasId: string;
  code: string | null;
  materials: Array<{
    id: string;
    fileCanvasId: string | null;
    fileName: string | null;
    fileUpdatedAt: Date | null;
    localPath: string | null;
  }>;
}

export interface ManifestCourse {
  canvasId: string;
  code: string | null;
  /** The readable folder name beside the numeric one, e.g. "MISM2301". */
  alias: string | null;
}

export interface ManifestFile {
  /** Fetch the bytes from /api/sigwald/materials/<materialId>/file. */
  materialId: string;
  courseCanvasId: string;
  fileCanvasId: string;
  fileName: string;
  /** Path inside the cache root, "/"-separated: "265615/44690311-ERP.pptx". */
  path: string;
  /** Bytes on disk now, which is what the file route will send. */
  sizeBytes: number;
  /** When Canvas last changed the file; a copy older than this is stale. */
  fileUpdatedAt: string | null;
}

export interface MaterialManifest {
  courses: ManifestCourse[];
  files: ManifestFile[];
}

/**
 * One entry per cached material, files shared by several module items
 * included once per item (each item's id fetches the same bytes). Only files
 * actually on disk inside the cache root are listed, so every entry can be
 * fetched.
 */
export async function buildMaterialManifest(courses: ManifestCourseRow[]): Promise<MaterialManifest> {
  const root = materialsRoot();
  const files: ManifestFile[] = [];
  for (const course of courses) {
    for (const m of course.materials) {
      if (!m.localPath || !m.fileCanvasId || !isInsideMaterialsRoot(m.localPath)) {
        continue;
      }
      const info = await stat(m.localPath).catch(() => null);
      if (!info?.isFile()) {
        continue;
      }
      files.push({
        materialId: m.id,
        courseCanvasId: course.canvasId,
        fileCanvasId: m.fileCanvasId,
        fileName: m.fileName ?? path.basename(m.localPath),
        path: path.relative(root, path.resolve(m.localPath)).split(path.sep).join("/"),
        sizeBytes: info.size,
        fileUpdatedAt: m.fileUpdatedAt?.toISOString() ?? null,
      });
    }
  }
  return {
    courses: courses.map((c) => ({ canvasId: c.canvasId, code: c.code, alias: courseFolderAlias(c.code) })),
    files,
  };
}
