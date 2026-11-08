"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useCourseActivityStore } from "@/store/courseActivity";
import { ALL_COURSES, type CoursesView, useCourseLibraryStore } from "@/store/courseLibrary";

import type { LibraryCourse } from "@/types/course-materials";

import { ActivitySheet } from "./ActivitySheet";
import { courseTab } from "./course-tab";
import { GradesSheet } from "./GradesSheet";
import { LibrarySheet, openCount } from "./LibrarySheet";
import { NewsSheet } from "./NewsSheet";
import { UrlAsk } from "@/components/navigation/UrlAsk";
import { UnseenPip } from "@/components/sheet/sheet";

/**
 * /courses — Canvas, mirrored, as one workbook. The top bar picks the view
 * (Activity · Grades · News · Library); the sheet tabs along the bottom pick
 * All or one course, the way Excel's do. Each view is a ruled sheet with a
 * reading pane. View, tab and selection live in the URL, so any row can be
 * linked to (`?view=grades&course=<id>&sel=<assignment>`; the old `?m=<material>`
 * still opens Library).
 */

const VIEWS: readonly CoursesView[] = ["activity", "grades", "news", "library"];

type Selection = Record<CoursesView, string | null>;
const NO_SELECTION: Selection = { activity: null, grades: null, news: null, library: null };

function readUrl(): { view: CoursesView | null; course: string | null; sel: string | null; material: string | null } {
  if (typeof window === "undefined") return { view: null, course: null, sel: null, material: null };
  const p = new URLSearchParams(window.location.search);
  const view = p.get("view");
  return {
    view: VIEWS.includes(view as CoursesView) ? (view as CoursesView) : null,
    course: p.get("course"),
    sel: p.get("sel"),
    material: p.get("m"),
  };
}

function ownerOf(courses: LibraryCourse[], materialId: string): LibraryCourse | undefined {
  return courses.find((c) => [...c.modules.flatMap((m) => m.materials), ...c.unfiled].some((m) => m.id === materialId));
}

export function CourseLibrary() {
  const { courses, loaded, error, fetchCourses, view, setView, courseKey, setCourseKey } = useCourseLibraryStore();
  const totalUnseen = useCourseActivityStore((s) => s.unseenCount);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  // Where the URL says to open, until the courses arrive to resolve it against.
  const pendingUrl = useRef<ReturnType<typeof readUrl> | null>(readUrl());
  // A link that arrives while the page is open (the top bar's search), or
  // that a client-side navigation opened it on, is resolved the same way.
  // Its values come from the router: on a client-side navigation the page
  // renders before the address bar changes, so readUrl() above can still be
  // reading the page you came from.
  const [asks, setAsks] = useState(0);
  const reAsk = useCallback(({ m, course }: Record<string, string | null>) => {
    pendingUrl.current = { view: null, course: course ?? null, sel: null, material: m ?? null };
    setAsks((n) => n + 1);
  }, []);

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  // The URL decides where the page opens, once the courses are in.
  useEffect(() => {
    if (!loaded || !pendingUrl.current) return;
    const { view: v, course, sel, material } = pendingUrl.current;
    pendingUrl.current = null;
    if (material) {
      const owner = ownerOf(courses, material);
      setView("library");
      setCourseKey(owner?.id ?? ALL_COURSES);
      setSelection({ ...NO_SELECTION, library: material });
      return;
    }
    if (v) setView(v);
    setCourseKey(course && courses.some((c) => c.id === course) ? course : ALL_COURSES);
    if (v && sel) setSelection({ ...NO_SELECTION, [v]: sel });
  }, [loaded, courses, setView, setCourseKey, asks]);

  // A course that stopped being live can't stay selected.
  useEffect(() => {
    if (loaded && courseKey !== ALL_COURSES && !courses.some((c) => c.id === courseKey)) setCourseKey(ALL_COURSES);
  }, [loaded, courses, courseKey, setCourseKey]);

  // …and the page writes its state back, so a reload or a shared link lands in the same place.
  useEffect(() => {
    if (!loaded || pendingUrl.current) return;
    const params = new URLSearchParams({ view });
    if (courseKey !== ALL_COURSES) params.set("course", courseKey);
    const sel = selection[view];
    if (sel) params.set("sel", sel);
    window.history.replaceState(null, "", `/courses?${params}`);
  }, [loaded, view, courseKey, selection]);

  const select = useCallback((id: string | null) => setSelection((s) => ({ ...s, [view]: id })), [view]);
  const switchCourse = useCallback(
    (key: string) => {
      setCourseKey(key);
      setSelection((s) => ({ ...s, [view]: null }));
    },
    [setCourseKey, view]
  );

  // [ ] step through the sheet tabs, 1–4 pick the view — anywhere on the page but a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      const keys = [ALL_COURSES, ...courses.map((c) => c.id)];
      if (e.key === "[" || e.key === "]") {
        const i = keys.indexOf(courseKey);
        e.preventDefault();
        switchCourse(keys[(i + (e.key === "]" ? 1 : -1) + keys.length) % keys.length]);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        setView(VIEWS[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [courses, courseKey, switchCourse, setView]);

  // Kept on the URL: this page writes its own state there, so the URL already
  // moves with what's on screen. A material (?m=) or a course from the search.
  const urlAsks = (
    <>
      <UrlAsk names={["m"]} keep onAsk={reAsk} />
      <UrlAsk names={["course"]} keep onAsk={reAsk} />
    </>
  );

  if (!loaded) {
    return (
      <p className="p-6 text-[13px] text-muted-foreground">
        {urlAsks}
        Loading courses…
      </p>
    );
  }
  if (error) {
    return <p className="p-6 text-[13px] text-destructive">{error}</p>;
  }
  if (courses.length === 0) {
    return (
      <div className="p-6 text-[14px] text-muted-foreground">
        <p>No courses mirrored yet.</p>
        <p className="mt-1">Connect Canvas in Settings, then press Sync Canvas above.</p>
      </div>
    );
  }

  const one = courseKey === ALL_COURSES ? null : (courses.find((c) => c.id === courseKey) ?? null);
  const tabCourse = one?.id ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {urlAsks}
      {view === "activity" ? (
        <ActivitySheet courses={courses} courseKey={tabCourse} selected={selection.activity} onSelect={select} />
      ) : view === "grades" ? (
        <GradesSheet
          courseKey={tabCourse}
          selected={selection.grades}
          onSelect={select}
          onOpenCourse={(id) => switchCourse(id)}
        />
      ) : view === "news" ? (
        <NewsSheet courseKey={tabCourse} selected={selection.news} onSelect={select} />
      ) : (
        <LibrarySheet courses={one ? [one] : courses} selected={selection.library} onSelect={select} />
      )}

      {/* Sheet tabs: All, then one per course. The badge follows the view. */}
      <div className="flex flex-none items-stretch overflow-x-auto border-t border-border bg-background">
        <SheetTab
          label="All"
          title="Every course"
          selected={courseKey === ALL_COURSES}
          onClick={() => switchCourse(ALL_COURSES)}
          badge={view === "activity" || view === "news" ? totalUnseen || null : null}
          unseen={view === "activity" || view === "news" ? totalUnseen > 0 : false}
        />
        {courses.map((c) => {
          const badge =
            view === "library"
              ? openCount(c) || null
              : view === "grades"
                ? c.currentScore != null
                  ? `${Math.round(c.currentScore * 10) / 10}`
                  : null
                : c.unseenCount || null;
          return (
            <SheetTab
              key={c.id}
              label={courseTab(c)}
              title={c.name}
              selected={c.id === courseKey}
              onClick={() => switchCourse(c.id)}
              badge={badge}
              unseen={view !== "library" && view !== "grades" && c.unseenCount > 0}
            />
          );
        })}
      </div>
    </div>
  );
}

function SheetTab({
  label,
  title,
  selected,
  onClick,
  badge,
  unseen,
}: {
  label: string;
  title: string;
  selected: boolean;
  onClick: () => void;
  badge: number | string | null;
  unseen: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-9 flex-none items-center gap-1.5 whitespace-nowrap border-r border-border px-3 text-sm transition-colors duration-150",
        selected ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {unseen ? <UnseenPip /> : null}
      <span>{label}</span>
      {badge != null ? (
        <span className={cn("font-mono text-[11px] tabular-nums", selected ? "text-background/80" : "text-muted-foreground")}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}
