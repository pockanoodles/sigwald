"use client";

import { useCallback, useEffect } from "react";

import { DayView } from "@/components/calendar/DayView";
import { FeedManager } from "@/components/calendar/FeedManager";
import { MonthView } from "@/components/calendar/MonthView";
import { MultiMonthView } from "@/components/calendar/MultiMonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { UrlAsk } from "@/components/navigation/UrlAsk";
import { useHorizontalSwipe } from "@/components/ui/swipeable-row";

import { addDays, subDays } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

import { useIsMobile } from "@/hooks/use-media-query";

import {
  useCalendarStore,
  useCalendarUIStore,
  useViewStore,
} from "@/store/calendar";
import { useTaskStore } from "@/store/task";

import { CalendarEvent, CalendarFeed } from "@/types/calendar";

let mobileDefaultApplied = false;

interface CalendarProps {
  initialFeeds?: CalendarFeed[];
  initialEvents?: CalendarEvent[];
}

export function Calendar({
  initialFeeds = [],
  initialEvents = [],
}: CalendarProps) {
  // Period, view and the feed sidebar are all driven from the app top bar now
  // (components/calendar/CalendarTopBar.tsx) through these same stores.
  const { date: currentDate, setDate, view, setView } = useViewStore();
  const isMobile = useIsMobile();
  const { isSidebarOpen, isMobileDrawerOpen, isHydrated, setMobileDrawerOpen } =
    useCalendarUIStore();
  const { setFeeds, setEvents } = useCalendarStore();

  // On a 393px phone screen, a 7-column Week grid gives each day ~45px. The
  // first Calendar of a page load on a phone opens on Day; Week/Month/Year
  // stay one tap away, and a view picked after that holds across visits.
  useEffect(() => {
    if (isMobile && !mobileDefaultApplied) {
      mobileDefaultApplied = true;
      if (view === "week") {
        setView("day");
      }
    }
  }, [isMobile, view, setView]);

  useEffect(() => {
    if (!isMobile) {
      setMobileDrawerOpen(false);
    }
  }, [isMobile, setMobileDrawerOpen]);

  const stepPeriod = useCallback(
    (direction: -1 | 1) => {
      if (view === "month" || view === "multiMonth") {
        const next = new Date(currentDate);
        next.setMonth(next.getMonth() + direction);
        setDate(next);
        return;
      }
      const days = view === "day" ? 1 : 7;
      setDate(
        direction === -1
          ? subDays(currentDate, days)
          : addDays(currentDate, days)
      );
    },
    [currentDate, setDate, view]
  );

  const swipeHandlers = useHorizontalSwipe({
    disabled: !isMobile || isMobileDrawerOpen,
    onSwipeLeft: () => stepPeriod(1),
    onSwipeRight: () => stepPeriod(-1),
  });

  // Use initial data from server for hydration
  useEffect(() => {
    if (initialFeeds.length > 0) {
      setFeeds(initialFeeds);
    }

    if (initialEvents.length > 0) {
      setEvents(initialEvents);
    }

    // Only fetch from database if we didn't get initial data
    if (!initialFeeds.length || !initialEvents.length) {
      useCalendarStore.getState().loadFromDatabase();
    }

    // Always fetch tasks since they're not pre-loaded
    useTaskStore.getState().fetchTasks();
  }, [initialFeeds, initialEvents, setFeeds, setEvents]);

  return (
    <div className="relative flex h-full w-full">
      {isMobile ? (
        <>
          <div
            onClick={() => setMobileDrawerOpen(false)}
            aria-hidden
            className={cn(
              "fixed inset-0 z-30 bg-background/70 transition-opacity duration-200 motion-reduce:transition-none",
              isMobileDrawerOpen
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            )}
          />
          <aside
            aria-hidden={!isMobileDrawerOpen}
            className={cn(
              "fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom,0px))] left-0 top-[calc(theme(spacing.topbar)+env(safe-area-inset-top,0px))] z-40 w-64 border-r border-border bg-background",
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              isMobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <FeedManager />
          </aside>
        </>
      ) : (
        /* Sidebar. Width animates against a fixed-width inner panel (same trick
           as AppNav) so nothing reflows while it collapses — and `min-w-0` is
           load-bearing: without it the flex item's `min-width: auto` let the
           mini-calendar push a nominally 224px rail out to 320px. */
        <aside
          className={cn(
            "h-full min-w-0 flex-none overflow-hidden border-r border-border bg-background",
            "transition-[width] duration-300 ease-out motion-reduce:transition-none",
            isSidebarOpen ? "w-sidebar" : "w-0",
            !isHydrated && "duration-0"
          )}
        >
          <div className="h-full w-sidebar">
            <FeedManager />
          </div>
        </aside>
      )}

      {/* Main content. No header of its own — the grid starts directly under
          the app top bar, which owns the period, the stepping and the view. */}
      <main
        className="flex min-w-0 flex-1 flex-col bg-background"
        {...swipeHandlers}
      >
        {/* ?date=2026-11-14 (the top bar's search opening an event) moves to
            that day in the view you're on. */}
        <UrlAsk names={["date"]} onAsk={({ date }) => openDay(date, setDate)} />
        <div className="flex-1 overflow-hidden">
          {view === "day" ? (
            <DayView currentDate={currentDate} onDateClick={setDate} />
          ) : view === "week" ? (
            <WeekView currentDate={currentDate} onDateClick={setDate} />
          ) : view === "month" ? (
            <MonthView currentDate={currentDate} onDateClick={setDate} />
          ) : (
            <MultiMonthView currentDate={currentDate} onDateClick={setDate} />
          )}
        </div>
      </main>
    </div>
  );
}

/** A "2026-11-14" from the URL, as that local day; anything else is ignored. */
function openDay(day: string | null, setDate: (date: Date) => void) {
  const m = day?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) setDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
