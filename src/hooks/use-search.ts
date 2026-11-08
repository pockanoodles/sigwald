"use client";

import { useEffect, useRef, useState } from "react";

import {
  SEARCH_MIN_LENGTH,
  type SearchGroup,
  type SearchResponse,
} from "@/lib/search/types";

/** Long enough to skip the keystrokes of a word being typed, short enough to feel live. */
const DEBOUNCE_MS = 120;

export interface SearchState {
  /** The groups for `query`, or the previous query's until they arrive. */
  groups: SearchGroup[];
  status: "idle" | "loading" | "ready" | "error";
}

/**
 * The top bar's search, as you type: one request per pause, the one in flight
 * cancelled by the next, and answers kept while the palette is open so
 * backspacing over a query costs nothing. Closing the palette forgets them,
 * since what they found can change in the meantime.
 */
export function useSearch(query: string, open: boolean): SearchState {
  const [state, setState] = useState<SearchState>({
    groups: [],
    status: "idle",
  });
  const cache = useRef(new Map<string, SearchGroup[]>());

  useEffect(() => {
    if (!open) {
      cache.current.clear();
      setState({ groups: [], status: "idle" });
    }
  }, [open]);

  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < SEARCH_MIN_LENGTH) {
      setState({ groups: [], status: "idle" });
      return;
    }
    const known = cache.current.get(text.toLowerCase());
    if (known) {
      setState({ groups: known, status: "ready" });
      return;
    }
    setState((s) => ({ groups: s.groups, status: "loading" }));
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`, {
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(`Search answered ${res.status}`);
        const { groups } = (await res.json()) as SearchResponse;
        cache.current.set(text.toLowerCase(), groups);
        setState({ groups, status: "ready" });
      } catch {
        if (!abort.signal.aborted) setState({ groups: [], status: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, open]);

  return state;
}
