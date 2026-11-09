/**
 * Intake's rules, pure so they can be checked without a database.
 *
 * A script that can read what a person was told (ops reads Canvas
 * announcements and Inbox messages with a local model) proposes the work in
 * it: what, by when, and the source's own words for both. Sigwald decides,
 * and never takes a model's word for anything it can check:
 *
 *  - **Duplicate**: it's work Sigwald already has, a task due at the same
 *    moment that shares a word with it, or due the same day under much the
 *    same name. An announcement reminding you of an assignment isn't a
 *    second assignment.
 *  - **Accepted on its own**: the source can make work (an instructor, not a
 *    mailing list), the sender found the quoted words in it and the deadline
 *    in those words, it isn't optional, and it's still ahead.
 *  - **Pending** otherwise, for the person to accept or dismiss on Today.
 *  - A deadline already past is dismissed: it isn't work anymore.
 */

export const INTAKE_SOURCE = "INTAKE";

export type ProposalStatus = "pending" | "accepted" | "dismissed" | "duplicate";

export interface ProposalInput {
  ref: string;
  title: string;
  dueAt: Date;
  duration: number | null;
  evidence: string;
  dueText: string;
  sourceLabel: string;
  sourceUrl: string | null;
  claims: string[];
  trusted: boolean;
  optional: boolean;
  grounded: boolean;
}

/** Work Sigwald already has, as far as matching reads it. */
export interface KnownWork {
  /** A task's id; null for a proposal still waiting, which has no task yet. */
  taskId: string | null;
  title: string;
  dueAt: Date | null;
}

export type Decision =
  | { status: "duplicate"; taskId: string | null }
  | { status: "accepted" }
  | { status: "pending" }
  | { status: "dismissed" };

const HOUR = 3_600_000;
const MAX_REF = 200;
const MAX_TITLE = 140;
const MAX_TEXT = 1000;
const MAX_PROPOSALS = 200;
const INSTANT = /(Z|[+-]\d{2}:\d{2})$/;

/** Words too common to say two titles name the same work. */
const STOPWORDS = new Set(
  "a an and or the to for of in on at by before after with from your you is are be this that it its due read finish submit complete do".split(
    " "
  )
);

/** The words that carry a title: lowercase, no stopwords; numbers kept ("Chapter 9"). */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)))
  );
}

function overlap(a: Set<string>, b: Set<string>): { shared: number; jaccard: number } {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  const union = a.size + b.size - shared;
  return { shared, jaccard: union === 0 ? 0 : shared / union };
}

/** The work a proposal repeats, if Sigwald has it. */
export function findDuplicate(proposal: Pick<ProposalInput, "title" | "dueAt">, known: KnownWork[]): KnownWork | null {
  const words = titleWords(proposal.title);
  let best: { work: KnownWork; jaccard: number } | null = null;
  for (const work of known) {
    const { shared, jaccard } = overlap(words, titleWords(work.title));
    let same = false;
    if (work.dueAt) {
      const apart = Math.abs(work.dueAt.getTime() - proposal.dueAt.getTime());
      // Due at the same moment and about the same thing: "Read chapter 9 and
      // answer the DQ" (Friday 8:00) is the "Chap 9 DQ" assignment.
      same = (apart <= HOUR && shared >= 1) || (apart <= 24 * HOUR && jaccard >= 0.5);
    } else {
      same = jaccard >= 0.8;
    }
    // Several can match (a week's Module 11 work is all due at 11:59 PM): the closest name wins.
    if (same && (!best || jaccard > best.jaccard)) best = { work, jaccard };
  }
  return best?.work ?? null;
}

export function decide(proposal: ProposalInput, known: KnownWork[], now: Date): Decision {
  if (proposal.dueAt.getTime() <= now.getTime()) return { status: "dismissed" };
  const duplicate = findDuplicate(proposal, known);
  if (duplicate) return { status: "duplicate", taskId: duplicate.taskId };
  if (proposal.trusted && proposal.grounded && !proposal.optional) return { status: "accepted" };
  return { status: "pending" };
}

/** What the task an accepted proposal becomes says about where it came from. */
export function taskDescription(p: Pick<ProposalInput, "sourceLabel" | "evidence" | "dueText">): string {
  return `${p.sourceLabel}\n\n> ${p.evidence}\n\nDue: "${p.dueText}"`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** A PUT body's proposals, or what's wrong with it. */
export function parseProposals(raw: unknown): ProposalInput[] | string {
  if (!isRecord(raw) || !Array.isArray(raw.proposals)) return "proposals must be a list";
  if (raw.proposals.length > MAX_PROPOSALS) return `send at most ${MAX_PROPOSALS} proposals at a time`;
  const out: ProposalInput[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.proposals.entries()) {
    const where = `proposals[${i}]`;
    if (!isRecord(entry)) return `${where} must be an object`;
    const ref = text(entry.ref, MAX_REF);
    if (!ref) return `${where}.ref is required`;
    if (seen.has(ref)) return `${where} repeats ${ref}`;
    seen.add(ref);
    const title = text(entry.title, MAX_TITLE);
    if (!title) return `${where}.title is required`;
    const dueAt = typeof entry.dueAt === "string" && INSTANT.test(entry.dueAt) ? new Date(entry.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return `${where}.dueAt must be an ISO time with its offset`;
    const evidence = text(entry.evidence, MAX_TEXT);
    const dueText = text(entry.dueText, MAX_TEXT);
    const sourceLabel = text(entry.sourceLabel, MAX_TITLE);
    if (!evidence || !dueText || !sourceLabel) return `${where} needs evidence, dueText and sourceLabel`;
    const duration = entry.duration == null ? null : Number(entry.duration);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 24 * 60)) {
      return `${where}.duration must be whole minutes, at most a day`;
    }
    const sourceUrl = entry.sourceUrl == null ? null : text(entry.sourceUrl, MAX_TEXT);
    if (sourceUrl !== null && !/^https:\/\/\S+$/.test(sourceUrl)) return `${where}.sourceUrl must be an https link`;
    if (entry.claims !== undefined && (!Array.isArray(entry.claims) || entry.claims.some((c) => typeof c !== "string" || !c))) {
      return `${where}.claims must be a list of claim keys`;
    }
    for (const flag of ["trusted", "optional", "grounded"] as const) {
      if (typeof entry[flag] !== "boolean") return `${where}.${flag} must be true or false`;
    }
    out.push({
      ref,
      title,
      dueAt,
      duration,
      evidence,
      dueText,
      sourceLabel,
      sourceUrl,
      claims: [...new Set((entry.claims as string[] | undefined) ?? [])],
      trusted: entry.trusted as boolean,
      optional: entry.optional as boolean,
      grounded: entry.grounded as boolean,
    });
  }
  return out;
}
