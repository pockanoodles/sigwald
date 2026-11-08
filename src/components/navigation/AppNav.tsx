"use client";

import { useEffect } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { useIsMobile } from "@/hooks/use-media-query";

import { useModulesStore, useOnModules } from "@/store/modules";
import { useNavUIStore } from "@/store/navUi";

import { SettingsMenu } from "./SettingsMenu";

interface AppNavProps {
  className?: string;
}

/** The core: every Sigwald has these, in this order, and they never move. */
const CORE_LINKS = [
  { href: "/today", label: "Today" },
  { href: "/focus", label: "Focus" },
  { href: "/calendar", label: "Calendar" },
  { href: "/tasks", label: "Tasks" },
];

/** Left nav rail — links only. Collapsing animates the rail's width against a
 *  fixed-width inner nav, so the labels fade and get clipped instead of
 *  reflowing.
 *
 *  Collapsed is zero width, not an icon strip: the links are text-only, so a
 *  strip would be five blank rows charging 56px for them. Nothing lives in
 *  here that you lose when it's gone — the collapse toggle and search sit in
 *  the app top bar, which is always on screen at a fixed position (that
 *  replaced a semi-transparent tab that floated in the middle of the left
 *  edge, which is the thing this rail should never need again).
 *
 *  Under the core links sits the Modules row, always there, and under it the
 *  modules this person has on, in the order they set on /modules. So turning
 *  a module on only ever grows the middle: the core above and Settings at the
 *  bottom stay exactly where they were.
 *
 *  Below `md` the same links render as an overlay drawer instead. A 192px
 *  column inside a 393px viewport is half the screen, so on a phone the rail
 *  stops being a column and starts being something you pull over the page and
 *  dismiss. The top-bar toggle stays in the identical spot either way — it just
 *  drives a different piece of state. */
export function AppNav({ className }: AppNavProps) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { isNavOpen, isDrawerOpen, isHydrated, setDrawerOpen } =
    useNavUIStore();
  const modules = useOnModules();
  const loadModules = useModulesStore((s) => s.load);

  // Another tab or device may have changed them: check on navigation (the
  // store throttles that) and whenever the window comes back to the front.
  useEffect(() => {
    void loadModules();
  }, [loadModules, pathname]);

  useEffect(() => {
    const onFocus = () => void loadModules({ force: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadModules]);

  // Navigating is the drawer's job done — leaving it open would bury the page
  // the tap just loaded.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);

  // Rotating to landscape (or resizing a desktop window down and back) must not
  // strand a drawer open on top of the inline rail.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile, setDrawerOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDrawerOpen, setDrawerOpen]);

  const label = cn(
    "transition-opacity duration-ui ease-field motion-reduce:transition-none",
    isNavOpen ? "opacity-100" : "opacity-0"
  );

  const tabIndex = isMobile ? (isDrawerOpen ? 0 : -1) : isNavOpen ? 0 : -1;

  const navLink = (href: string, text: string) => {
    const isActive = pathname === href;

    return (
      <Link
        key={href}
        href={href}
        title={text}
        tabIndex={tabIndex}
        className={cn(
          "mx-2 flex items-center whitespace-nowrap px-2.5 text-[13px] font-normal transition-colors duration-150",
          // 40px is fine for a pointer and under the 44px touch floor.
          isMobile ? "h-11" : "h-8",
          // Where you are is framed, crate-stencil style, in ink corner
          // brackets. It is not "now", so it stays out of the rust.
          isActive
            ? "er-brackets font-medium text-foreground [--bracket:var(--er-ink)]"
            : "text-muted-foreground hover:bg-hover hover:text-foreground"
        )}
      >
        <span className={isMobile ? undefined : label}>{text}</span>
      </Link>
    );
  };

  const onCatalog = pathname?.startsWith("/modules") ?? false;

  const links = (
    <>
      {CORE_LINKS.map((link) => navLink(link.href, link.label))}

      {/* Always drawn, with or without modules on, so it never appears or
          vanishes under you. It opens the catalog. */}
      <Link
        href="/modules"
        title="Modules: turn parts of Sigwald on or off"
        tabIndex={tabIndex}
        className={cn(
          "mx-2 mt-4 flex items-center whitespace-nowrap px-2.5 transition-colors duration-150",
          isMobile ? "h-11" : "h-7",
          onCatalog ? "er-brackets [--bracket:var(--er-ink)]" : "hover:bg-hover"
        )}
      >
        <span className={cn("er-label", isMobile ? undefined : label)}>
          Modules
        </span>
      </Link>

      {modules.map((m) => (m.page ? navLink(m.page.href, m.name) : null))}
    </>
  );

  if (isMobile) {
    return (
      <>
        {/* Rendered unconditionally and faded, so the drawer can animate out
            rather than vanishing the instant state flips. */}
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden
          className={cn(
            "fixed inset-0 z-40 bg-background/70 transition-opacity duration-ui ease-field motion-reduce:transition-none",
            isDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        />
        <div
          className={cn(
            "fixed bottom-0 left-0 top-[calc(theme(spacing.topbar)+env(safe-area-inset-top,0px))] z-50 w-64 border-r border-border bg-sidebar pb-[calc(3.25rem+env(safe-area-inset-bottom,0px))]",
            "transition-transform duration-ui ease-field motion-reduce:transition-none",
            isDrawerOpen ? "translate-x-0" : "-translate-x-full",
            className
          )}
        >
          <nav
            className="flex h-full flex-col py-2"
            aria-hidden={!isDrawerOpen}
          >
            {links}
            <div className="mt-auto">
              <SettingsMenu />
            </div>
          </nav>
        </div>
      </>
    );
  }

  return (
    <div
      className={cn(
        // overflow-clip (not hidden): focusing the full-width Settings row must
        // never scroll the clipped rail and shove it offscreen.
        "er-grain h-full flex-none overflow-clip bg-sidebar",
        "transition-[width] duration-rail ease-field motion-reduce:transition-none",
        // The hairline is part of the rail, so it leaves with it — a border on
        // a zero-width element still paints a 1px line down the page.
        isNavOpen ? "w-rail border-r border-border" : "w-0",
        !isHydrated && "duration-0",
        className
      )}
    >
      <nav
        className="flex h-full w-rail flex-col py-3"
        aria-hidden={!isNavOpen}
      >
        {links}

        <div className="mt-auto">
          <SettingsMenu labelClassName={label} />
        </div>
      </nav>
    </div>
  );
}
