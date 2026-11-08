/**
 * What the top bar's search sends back (GET /api/search). Plain data, safe in
 * the browser: the palette renders these and never knows which module a group
 * came from.
 */

/** One thing the search found, and the page that opens on it. */
export interface SearchHit {
  id: string;
  title: string;
  /** A quiet second word: a course code, an org, "Done". */
  detail?: string | null;
  /** When it's due or happens, already worded in the person's zone ("Due tomorrow"). */
  when?: string | null;
  /** The page that shows it, opened on it ("/people?person=…"). */
  href: string;
  /** How well it matched, lower is better (lib/search/rank.ts). Orders the groups. */
  rank: number;
}

/** One heading's worth of hits, best first. */
export interface SearchGroup {
  /** Stable, for React keys: "tasks", "people". */
  id: string;
  /** The heading in the palette. */
  label: string;
  hits: SearchHit[];
}

export interface SearchResponse {
  groups: SearchGroup[];
}

/** What a search source is asked, the core's and each module's alike. */
export interface SearchQuery {
  /** Trimmed, at least SEARCH_MIN_LENGTH characters. */
  text: string;
  now: Date;
  /** The person's zone, to word dates in. */
  timeZone: string;
  timeFormat: "12h" | "24h";
}

/** Fewer characters match too much to be worth a round-trip. */
export const SEARCH_MIN_LENGTH = 2;
/** Anything longer is a paste, not a search. */
export const SEARCH_MAX_LENGTH = 100;
/** Hits per group: the palette is a jump list, not a results page. */
export const SEARCH_GROUP_LIMIT = 5;
/** Rows a source reads before ranking, so a good match deep in the table still wins. */
export const SEARCH_CANDIDATES = 40;
