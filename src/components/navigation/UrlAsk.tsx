"use client";

import { Suspense, useEffect, useRef } from "react";

import { usePathname, useSearchParams } from "next/navigation";

type Ask = Record<string, string | null>;

interface UrlAskProps {
  /** The params it reads. It fires when the first of them changes to a value. */
  names: readonly [string, ...string[]];
  /** Every name's value, the first one set. */
  onAsk: (ask: Ask) => void;
  /**
   * Leave the params on the URL. For a page that writes its own state into
   * the URL (Courses), where the URL already moves with what's on screen and
   * taking them off would race its own write.
   */
  keep?: boolean;
}

/**
 * A link that opens a page on one thing (`/people?person=…`, the top bar's
 * search) is read here, whether it loads the page or arrives while the page
 * is already open, and then taken off the URL: asking for the same thing
 * again has to read as a new ask, and a reload shouldn't pin it. Renders
 * nothing; only it waits on the URL, not the page around it.
 */
export function UrlAsk(props: UrlAskProps) {
  return (
    <Suspense fallback={null}>
      <Reader {...props} />
    </Suspense>
  );
}

function Reader({ names, onAsk, keep = false }: UrlAskProps) {
  const params = useSearchParams();
  const pathname = usePathname();
  const value = params.get(names[0]);
  // The latest callback, without making every render a new ask.
  const ask = useRef(onAsk);
  ask.current = onAsk;

  useEffect(() => {
    if (!value) return;
    ask.current(Object.fromEntries(names.map((n) => [n, params.get(n)])));
    if (keep) return;
    // From the router's view of the URL, which is the new page's even while
    // a navigation is landing.
    const rest = new URLSearchParams(params);
    for (const n of names) rest.delete(n);
    // The history API, not router.replace: Next keeps useSearchParams in step
    // with it, and it doesn't re-render a server page (Calendar refetching
    // every event) just to drop a param. The state has to be null: Next reads
    // its own state object as one of its internal calls, skips syncing the
    // router, and puts the old URL back on its next render.
    window.history.replaceState(
      null,
      "",
      rest.size ? `${pathname}?${rest}` : pathname
    );
    // A new value is a new ask; nothing else is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return null;
}
