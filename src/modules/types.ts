/**
 * A module is an optional part of Sigwald that each person turns on or off on
 * /modules. The core (Today, Focus, Calendar, Tasks) works without any of
 * them; a module adds to the core through fixed slots, and the core never
 * reaches into a module.
 *
 * Each module is split in three so the browser bundle never pulls in server
 * code: `manifest.ts` is plain data and safe anywhere, its components are
 * listed in `src/modules/client.tsx`, and its jobs and ranking hooks in
 * `src/modules/server.ts`.
 */

export type ModuleId =
  | "courses"
  | "ladder"
  | "people"
  | "training"
  | "nutrition"
  | "work"
  | "code";

/** One thing a module sends out of Sigwald, written for someone who isn't an engineer. */
export interface ModuleEgress {
  /** Who receives it: "Your school's Canvas". */
  to: string;
  /** What goes there. */
  sends: string;
  /** What it's for. */
  why: string;
}

export interface ModuleManifest {
  id: ModuleId;
  name: string;
  /** One sentence for the catalog. */
  summary: string;
  /** Whether it's on for someone who has never turned it on or off. */
  defaultOn: boolean;
  /** Still taking shape: it works, but what it does and keeps may change. */
  beta?: boolean;
  /** Its one entry in the rail. Other views of it live in the top bar. */
  page?: { href: string; keywords: string[] };
  /** The `Task.source` values it owns. When it's off, those tasks leave every list. */
  sources: string[];
  /** What a task's link says, per source it owns ("Open in Canvas"). */
  linkLabels?: Record<string, string>;
  /**
   * What the goal form calls claiming every task of a source it owns ("All
   * Canvas work"). A source without one can't be claimed whole.
   */
  claimLabels?: Record<string, string>;
  /** What it adds to the core, one short line each. */
  adds: string[];
  /** What it stores, plainly. */
  keeps: string;
  /** Everything it sends out of Sigwald. Empty means nothing leaves. */
  egress: ModuleEgress[];
}

/** A module as one person has it. */
export interface ModuleState {
  id: ModuleId;
  on: boolean;
  /** Order in the rail, lowest first. */
  position: number;
}

/** What GET /api/modules returns per module. */
export type ModuleListing = ModuleManifest & Omit<ModuleState, "id">;

/** A claim a module offers goals beyond whole sources (Courses: a course). */
export interface ClaimOption {
  /** What the goal stores in taskSources ("course:<Canvas course id>"). */
  key: string;
  /** The chip's text (SCHM2301). */
  label: string;
  /** The chip's tooltip (the course's full name). */
  title: string;
}

/**
 * Something a module keeps that a Ladder boss can name as its proof (Courses:
 * a gradebook item), as it stands now. Ladder settles bosses from these
 * without reading the module's tables (src/modules/server.ts `proofItems`).
 */
export interface ProofItem {
  /** What the goal stores to name it: Canvas's id, in Goal.canvasAssignmentId. */
  ref: string;
  name: string;
  /** The module's own grouping, for the goal form (Courses: the course row). */
  groupId: string;
  /** Canvas's course code, e.g. "SCHM2301.10244.202710". */
  courseCode: string | null;
  dueAt: Date | null;
  state: "open" | "done" | "missed";
  /** What it says now: "Graded 90 / 100", "Handed in", "Missed". */
  label: string;
  /** Handed in, graded or excused: it fells the boss that names it. */
  settles: boolean;
  /** The task that is its work, if Sigwald tracks one. */
  task: { id: string; goalsPinned: boolean } | null;
}
