/**
 * On-disk cache for Canvas course files. Local runtime state, outside the
 * repo: `SIGWALD_MATERIALS_DIR` (default ~/.sigwald/materials), one folder per
 * Canvas course (plus a course-code alias beside it), one file per Canvas file
 * id — shared by every module item that points at it.
 */
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

const DEFAULT_MAX_FILE_MB = 100;

export function materialsRoot(): string {
  return process.env.SIGWALD_MATERIALS_DIR || path.join(os.homedir(), ".sigwald", "materials");
}

/** Files above this are recorded but not downloaded (lecture recordings, datasets). */
export function maxFileBytes(): number {
  const mb = Number(process.env.SIGWALD_MATERIALS_MAX_FILE_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_FILE_MB) * 1_000_000;
}

function safeName(name: string): string {
  return name.replace(/[/\\:\0]/g, "_").slice(0, 150) || "file";
}

export function localPathFor(courseCanvasId: string, fileCanvasId: string, displayName: string): string {
  return path.join(materialsRoot(), courseCanvasId, `${fileCanvasId}-${safeName(displayName)}`);
}

/**
 * Write a download to `dest` via a temp file + rename, so a failed or
 * interrupted download never leaves a truncated file that looks complete.
 */
export async function writeDownload(
  body: ReadableStream<Uint8Array>,
  dest: string
): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  try {
    await pipeline(
      Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>),
      createWriteStream(tmp)
    );
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** The readable folder name for a course: "MISM2301.10244.202710" → "MISM2301", or null. */
export function courseFolderAlias(courseCode: string | null): string | null {
  return courseCode?.match(/^[A-Z]{2,5}\s?\d{4}/)?.[0].replace(/\s/, "") ?? null;
}

/**
 * A readable name beside each course's numeric folder — `MISM2301 → 265615` —
 * so a person or a shell session can find a course's files without looking up
 * its Canvas id. Best effort: a name already taken by something else is left alone.
 */
export async function linkCourseFolder(courseCanvasId: string, courseCode: string | null): Promise<void> {
  const alias = courseFolderAlias(courseCode);
  if (!alias) {
    return;
  }
  const link = path.join(materialsRoot(), alias);
  try {
    const existing = await lstat(link).catch(() => null);
    if (existing && (!existing.isSymbolicLink() || (await readlink(link)) === courseCanvasId)) {
      return;
    }
    await mkdir(materialsRoot(), { recursive: true });
    if (existing) {
      await rm(link);
    }
    await symlink(courseCanvasId, link);
  } catch {
    // A missing alias costs a lookup, never a sync.
  }
}

/**
 * Delete cached files in a course's folder that no material points at any
 * more: files Canvas dropped, versions a renamed file left behind, and
 * `.partial` leftovers from an interrupted download. Only Sigwald's own
 * `<file id>-<name>` entries are touched. Returns how many were removed.
 */
export async function pruneCourseFolder(courseCanvasId: string, keep: ReadonlySet<string>): Promise<number> {
  const dir = path.join(materialsRoot(), courseCanvasId);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (!entry.isFile() || !/^\d+-/.test(entry.name) || keep.has(full)) {
      continue;
    }
    await rm(full, { force: true });
    removed += 1;
  }
  return removed;
}

/** Only serve paths inside the cache root — a stored path is data, not trust. */
export function isInsideMaterialsRoot(p: string): boolean {
  const rel = path.relative(materialsRoot(), path.resolve(p));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
