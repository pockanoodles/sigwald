/** Client shapes for GET /api/sigwald/ladder (src/lib/sigwald/ladder.ts). */

import type { BossProof } from "@/lib/sigwald/boss-proof";
import type { StatKey } from "@/lib/sigwald/stats";

export type HexState = "past" | "current" | "future";

export interface HexRef {
  year: number;
  /** 1 to 6 within the year. */
  index: number;
}

export interface LadderHex extends HexRef {
  /** "Hex 5 · Sep–Oct 2026" */
  label: string;
  /** "Sep–Oct" */
  months: string;
  /** First and last calendar day, YYYY-MM-DD. */
  first: string;
  last: string;
  state: HexState;
  days: number;
  /** Days gone, today included: all of them once it's over, none before it starts. */
  elapsed: number;
  /** The hex's own row, if one was ever made: it carries the theme and the Build. */
  cycleId: string | null;
  theme: string;
  build: StatKey[];
  /** The vault's map sets the Build (ops' goal sync copies it each morning), so it can't change here. */
  buildProjected: boolean;
  /** A hex that hasn't begun shows the Build it will inherit: from these months. */
  inheritedFrom: string | null;
}

export interface LadderStat {
  key: StatKey;
  /** Lifetime XP as of the hex's last day, or today while it runs. */
  xp: number;
  level: number;
  into: number;
  span: number;
  toNext: number;
  /** XP earned inside the hex. */
  gained: number;
  build: boolean;
  /** Goals that develop it. */
  feeders: string[];
  /** A Build stat no goal develops, or one that earned nothing this hex. */
  flag: "starved" | "idle" | null;
}

export interface LadderGoal {
  id: string;
  title: string;
  /** active | done | dropped. A goal set aside shows only in a hex its work earned XP in. */
  status: string;
  /** What it develops: its own stats, or the ones above it. */
  stats: StatKey[];
  /** Its own stats, for editing; empty when it inherits. */
  develops: StatKey[];
  importance: number | null;
  /**
   * What feeds it: the sources, repos or courses whose work it claims. A goal
   * that claims nothing earns only from tasks linked to it by hand (or, for a
   * vault goal, the tasks ops made from its plan).
   */
  claims: { key: string; label: string }[];
  /** Projected from the vault, so it's edited there. */
  managed: boolean;
  isBoss: boolean;
  whyItMatters: string | null;
  definitionOfDone: string | null;
  targetDate: string | null;
  /** The goals it serves (the vault's `feeds:`). */
  parents: { id: string; title: string }[];
  xp: number;
  done: number;
  /** Tasks open and actionable now, whatever hex is showing. */
  open: number;
  nextBoss: { title: string; day: string } | null;
}

export interface LadderBoss {
  id: string;
  title: string;
  day: string;
  felled: boolean;
  goalTitle: string | null;
  /** How Sigwald knows it was beaten, and what that says now. */
  proof: BossProof;
  /** Projected from the vault, so it's edited there. */
  managed: boolean;
}

export interface LadderEvent {
  kind: "task" | "boss";
  id: string;
  title: string;
  day: string;
  /** The course's short label (SCHM2301) for coursework; null otherwise. */
  course: string | null;
  /** The goals credited. */
  goalIds: string[];
  stats: Partial<Record<StatKey, number>>;
  lost: number;
  /** A felled boss: what proved it, e.g. "Graded 90 / 100". */
  proof: string | null;
}

export interface LadderDay {
  day: string;
  done: number;
  xp: number;
}

export interface LadderYearHex {
  index: number;
  months: string;
  state: HexState;
  xp: number;
  done: number;
  build: StatKey[];
}

export interface LadderSummary {
  /** The character level: every stat's level added up. */
  level: number;
  xp: number;
  gained: number;
  done: number;
  /** Tasks finished in the hex that serve no goal, so they earned nothing. */
  unlinked: number;
  /** Share of the hex's XP that landed on its Build; null without either. */
  buildShare: number | null;
}

export interface LadderPayload {
  today: string;
  current: HexRef;
  hex: LadderHex;
  stats: LadderStat[];
  summary: LadderSummary;
  days: LadderDay[];
  goals: LadderGoal[];
  /** Bosses dated inside the hex. */
  bosses: LadderBoss[];
  /** The nearest boss still standing from today on, in any hex. */
  nextBoss: LadderBoss | null;
  /** Everything that earned XP in the hex, newest first. */
  events: LadderEvent[];
  /** The six hexes of the shown hex's year. */
  year: LadderYearHex[];
  /** Some goals come from the vault, so they're edited there. */
  managedExternally: boolean;
}
