"use client";

import { type ComponentType, useMemo } from "react";

import { usePathname } from "next/navigation";

import {
  HiOutlineChevronDoubleLeft,
  HiOutlineChevronDoubleRight,
  HiOutlineMenu,
  HiOutlineSearch,
} from "react-icons/hi";

import {
  CalendarTopBarActions,
  CalendarTopBarViews,
} from "@/components/calendar/CalendarTopBar";
import { SigwaldStatus } from "@/components/navigation/SigwaldStatus";
import { BarDivider } from "@/components/navigation/top-bar-parts";
import {
  TasksTopBarActions,
  TasksTopBarViews,
} from "@/components/tasks/TasksTopBar";

import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";

import { MODULES } from "@/modules";
import { CLIENT_MODULES } from "@/modules/client";

import { useIsMobile } from "@/hooks/use-media-query";

import { useCommandPaletteStore } from "@/store/commandPalette";
import { useOnModules } from "@/store/modules";
import { useNavUIStore } from "@/store/navUi";

/**
 * The one bar. Spans the full window above both the nav rail and the page, the
 * way an OS menu bar does, and it is the same 44px strip on every route.
 *
 * The rule that makes it worth having: a control that is in the bar is in the
 * same place on every screen. Before this, each page drew its own header —
 * different heights, different content, the rail's collapse toggle floating in
 * the middle of the left edge and vanishing when the rail was open. Anything
 * page-specific goes in the slots below; anything global (the toggle, the
 * counts, search) is fixed furniture that never moves between routes.
 */

interface RouteChrome {
  match: (pathname: string) => boolean;
  title: string;
  /** Sits left, next to the page title: view switchers, period stepping. */
  Views?: ComponentType;
  /** Sits right, before the status strip: things that change data. */
  Actions?: ComponentType;
  /**
   * Its Views carry a heading of their own (Calendar: the month), so below
   * desktop width the page name gives its room to them.
   */
  headingInViews?: boolean;
}

const CORE_ROUTES: readonly RouteChrome[] = [
  { match: (p) => p.startsWith("/today"), title: "Today" },
  { match: (p) => p.startsWith("/focus"), title: "Focus" },
  {
    match: (p) => p.startsWith("/calendar"),
    title: "Calendar",
    Views: CalendarTopBarViews,
    Actions: CalendarTopBarActions,
    headingInViews: true,
  },
  {
    match: (p) => p.startsWith("/tasks"),
    title: "Tasks",
    Views: TasksTopBarViews,
    Actions: TasksTopBarActions,
  },
  { match: (p) => p.startsWith("/modules"), title: "Modules" },
  { match: (p) => p.startsWith("/settings"), title: "Settings" },
];

/** A module's page keeps its name in the bar while it's off (the page says
 *  so), but its controls only draw while it's on. */
function moduleRoutes(onIds: ReadonlySet<string>): RouteChrome[] {
  return MODULES.flatMap((m) => {
    if (!m.page) return [];
    const href = m.page.href;
    const on = onIds.has(m.id);
    const chrome = CLIENT_MODULES[m.id];
    return [
      {
        match: (p: string) => p === href || p.startsWith(`${href}/`),
        title: m.name,
        Views: on ? chrome.Views : undefined,
        Actions: on ? chrome.Actions : undefined,
        headingInViews: on && chrome.headingInViews,
      },
    ];
  });
}

export function AppTopBar() {
  const pathname = usePathname() ?? "";
  const isMobile = useIsMobile();
  const { isNavOpen, isDrawerOpen, isHydrated, setNavOpen, setDrawerOpen } =
    useNavUIStore();
  const openPalette = useCommandPaletteStore((s) => s.setOpen);
  const modules = useOnModules();

  const routes = useMemo(
    () => [...CORE_ROUTES, ...moduleRoutes(new Set(modules.map((m) => m.id)))],
    [modules]
  );
  const route = routes.find((r) => r.match(pathname));
  const Views = route?.Views;
  const Actions = route?.Actions;

  // Same button, same pixel, two different pieces of state behind it: on a
  // phone the rail is an overlay, so "expanded" means the drawer is over the
  // page, not that a column is holding it open.
  const isOpen = isMobile ? isDrawerOpen : isNavOpen;
  const toggle = () =>
    isMobile ? setDrawerOpen(!isDrawerOpen) : setNavOpen(!isNavOpen);

  return (
    // `relative z-50` so the mobile drawer's scrim (fixed inset-0, z-40) paints
    // *under* the bar instead of dimming it and swallowing taps on the search
    // button. The drawer itself starts at `top-topbar`, so it never overlaps.
    <header className="app-titlebar er-grain relative z-50 flex h-topbar flex-none items-center gap-2 border-b border-border bg-background pr-2 md:pr-3">
      {/* The one control that never moves. Its slot is the rail's own left
          gutter, so the icon sits at exactly the same x whether the rail is
          open, closed, or mid-animation — which is the whole reason the
          floating edge tab that used to do this job is gone. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={isOpen}
        title={`${isOpen ? "Collapse" : "Expand"} sidebar (⌘\\)`}
        className="flex h-full w-12 flex-none items-center pl-[18px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {/* Direction is the only thing that changes; suppressed until hydration
            so the icon doesn't flip once on first paint. A chevron pointing
            into a column is the wrong metaphor for an overlay, so the drawer
            gets the hamburger every phone already reads as "menu". */}
        {isMobile ? (
          <HiOutlineMenu className="h-5 w-5 flex-none" />
        ) : isNavOpen || !isHydrated ? (
          <HiOutlineChevronDoubleLeft className="h-4 w-4 flex-none" />
        ) : (
          <HiOutlineChevronDoubleRight className="h-4 w-4 flex-none" />
        )}
      </button>

      {/* One 44px line on every route. The page's own controls keep their
          width: the counts on the right give way first (they truncate), and
          only then does this strip scroll rather than wrap. Below desktop
          width a page's view switcher is one menu (BarSegmented). */}
      <div className="flex min-w-0 flex-initial items-center gap-1 overflow-x-auto md:gap-2">
        {/* Michroma caps: the page's name reads like the plate on a piece of
            equipment, the same size on every route. */}
        <span
          className={cn(
            "er-display flex-none whitespace-nowrap text-[12px] tracking-[0.14em] text-foreground transition-opacity duration-ui ease-field",
            route?.headingInViews && "max-lg:pointer-events-none max-lg:w-0 max-lg:overflow-hidden max-lg:opacity-0 lg:opacity-100"
          )}
        >
          {route?.title ?? brand.name}
        </span>

        {Views ? (
          <>
            <span
              className={cn(
                "flex flex-none transition-opacity duration-ui ease-field",
                route?.headingInViews && "max-lg:pointer-events-none max-lg:w-0 max-lg:overflow-hidden max-lg:opacity-0 lg:opacity-100"
              )}
            >
              <BarDivider />
            </span>
            <Views />
          </>
        ) : null}
      </div>

      <div className="flex flex-1 items-center justify-end gap-3 pl-3">
        {/* The counts sit before the page's actions and take whatever room
            is free, so the actions stay put while counts load and change. */}
        <SigwaldStatus />

        {Actions ? (
          <div className="flex flex-none items-center gap-2">
            <Actions />
          </div>
        ) : null}

        {/* The one search, in the same corner on every route. It reads as a
            field and opens the ⌘K palette, which finds pages, tasks, events
            and what the modules keep, and runs commands. Pages don't grow
            search boxes of their own: Tasks' text filter is offered from
            here and lives in its Filter menu. */}
        <button
          type="button"
          onClick={() => openPalette(true)}
          aria-label="Search"
          className={cn(
            "flex flex-none items-center gap-2 rounded-md border border-border bg-raised",
            "text-xs text-muted-foreground transition-colors duration-150",
            "hover:border-foreground/30 hover:text-foreground",
            // A 208px field would eat half a phone's bar to advertise a
            // shortcut no phone has. Collapses to the icon alone.
            isMobile ? "h-9 w-9 justify-center" : "h-7 w-52 px-2"
          )}
        >
          <HiOutlineSearch
            className={cn("flex-none", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")}
          />
          {!isMobile && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="flex-none font-mono text-[11px] text-muted-foreground">
                ⌘K
              </kbd>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
