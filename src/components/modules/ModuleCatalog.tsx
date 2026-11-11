"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { HiSearch } from "react-icons/hi";
import { toast } from "sonner";

import {
  FilterStrip,
  HEAD,
  ROW,
  SheetLayout,
  StripCount,
  StripToggle,
  cellClass,
  gutterClass,
  sheetKeyHandler,
  titleCellClass,
  useScrollActiveIntoView,
} from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { cn } from "@/lib/utils";

import { MODULES, isModuleId } from "@/modules";
import { CLIENT_MODULES } from "@/modules/client";
import { SHELVES, shelfName } from "@/modules/shelves";
import type { ModuleId, ModuleManifest, ModuleShelf } from "@/modules/types";

import { useModulesStore } from "@/store/modules";

/**
 * The marketplace: every module this build ships, as a datasheet, with the
 * selected one shown whole in the reading pane — the same grammar as every
 * other sheet (components/sheet), where a cell truncates and the pane
 * doesn't. The strip above it searches (a name, a service, who it's for),
 * picks a shelf, and narrows to what's on.
 *
 * Rows stay in catalog order whatever is on, so turning one on never moves
 * the row under your pointer, and each keeps its catalog number when the
 * strip hides others, the way a filtered spreadsheet keeps its row numbers.
 * The rail order is set from the pane.
 */
export function ModuleCatalog() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const states = useModulesStore((s) => s.states);
  const known = useModulesStore((s) => s.known);
  const load = useModulesStore((s) => s.load);
  const [query, setQuery] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);

  useEffect(() => {
    void load({ force: true });
  }, [load]);

  const shelfParam = searchParams.get("shelf");
  const shelf = SHELVES.some((s) => s.id === shelfParam)
    ? (shelfParam as ModuleShelf)
    : null;

  const isOn = useCallback(
    (id: ModuleId) => known && states.some((s) => s.id === id && s.on),
    [known, states]
  );

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return MODULES.map((m, i) => ({ module: m, number: i + 1 })).filter(
      ({ module: m }) =>
        (!shelf || m.shelf === shelf) &&
        (!onlyOn || isOn(m.id)) &&
        words.every((w) => searchText(m).includes(w))
    );
  }, [query, shelf, onlyOn, isOn]);

  const param = searchParams.get("module");
  const selectedId: ModuleId =
    param && isModuleId(param) ? param : (rows[0]?.module.id ?? MODULES[0].id);
  const selected = MODULES.find((m) => m.id === selectedId) ?? MODULES[0];
  const activeIndex = rows.findIndex((r) => r.module.id === selectedId);

  const setParams = useCallback(
    (change: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(change)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const select = useCallback(
    (id: ModuleId) => setParams({ module: id }),
    [setParams]
  );

  useScrollActiveIntoView([selectedId]);
  const onKeyDown = sheetKeyHandler({
    count: rows.length,
    active: activeIndex,
    isSelectable: () => true,
    select: (i) => select(rows[i].module.id),
  });

  const onCount = MODULES.filter((m) => isOn(m.id)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterStrip>
        <div className="relative">
          <HiSearch className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a module, a service, who it's for…"
            aria-label="Search modules"
            className="h-8 w-48 pl-8 sm:w-72"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-8 flex-none items-center gap-1.5 border border-border px-2 font-mono text-xs uppercase tracking-wide transition-colors duration-150",
                shelf
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {shelf ? shelfName(shelf) : "Every shelf"}
              <span aria-hidden>▾</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup
              value={shelf ?? "all"}
              onValueChange={(v) =>
                setParams({ shelf: v === "all" ? null : v })
              }
            >
              <DropdownMenuRadioItem value="all">
                Every shelf
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {SHELVES.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  <span className="flex-1">{s.name}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {MODULES.filter((m) => m.shelf === s.id).length}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <StripToggle
          pressed={onlyOn}
          onClick={() => setOnlyOn((v) => !v)}
          title="Only the modules you have on"
        >
          On
        </StripToggle>
        <StripCount>
          {rows.length === MODULES.length
            ? `${MODULES.length} modules`
            : `${rows.length} of ${MODULES.length}`}
          {known ? ` · ${onCount} on` : ""}
        </StripCount>
      </FilterStrip>
      <SheetLayout
        label="Modules"
        onKeyDown={(e) => void onKeyDown(e)}
        sheet={
          <>
            <table className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 128 }} />
                <col />
                <col style={{ width: 180 }} />
                <col style={{ width: 72 }} />
              </colgroup>
              <thead>
                <tr>
                  {[
                    "#",
                    "Module",
                    "Shelf",
                    "Adds",
                    "Sends data to",
                    "State",
                  ].map((label, i) => (
                    <th
                      key={label}
                      scope="col"
                      className={cn(ROW, HEAD, i === 0 && "text-right")}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ module: m, number }) => (
                  <CatalogRow
                    key={m.id}
                    index={number}
                    module={m}
                    on={isOn(m.id)}
                    known={known}
                    active={m.id === selectedId}
                    onSelect={() => select(m.id)}
                  />
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-sm text-muted-foreground"
                    >
                      No module matches. Try a service&apos;s name, or what you
                      do (&ldquo;podcast&rdquo;, &ldquo;support&rdquo;).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <p className="max-w-2xl px-3 py-4 text-xs leading-relaxed text-muted-foreground">
              Today, Focus, Calendar and Tasks are always there. Modules add to
              them, and you can turn one off at any time: it leaves the rail and
              stops working, and nothing it stored is deleted. Modules that read
              another service only read it: none can change anything there.
            </p>
          </>
        }
        pane={
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ModulePane
              module={selected}
              on={isOn(selected.id)}
              known={known}
            />
          </div>
        }
      />
    </div>
  );
}

/** What the strip's search reads: name, summary, shelf, audience, service. */
function searchText(m: ModuleManifest): string {
  return [
    m.name,
    m.summary,
    shelfName(m.shelf),
    ...m.madeFor,
    m.connect?.service?.name ?? "",
    ...(m.page?.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function CatalogRow({
  index,
  module: m,
  on,
  known,
  active,
  onSelect,
}: {
  index: number;
  module: ModuleManifest;
  on: boolean;
  known: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const cell = cellClass(active);
  return (
    <tr
      onClick={onSelect}
      aria-selected={active}
      data-active-row={active || undefined}
      className="group cursor-default"
    >
      <td className={gutterClass(active)}>{index}</td>
      <td
        className={cn(
          cell,
          titleCellClass(active),
          "font-medium text-foreground"
        )}
      >
        {m.name}
        {m.beta ? <BetaTag className="ml-2" /> : null}
      </td>
      <td className={cn(cell, "text-muted-foreground")}>
        {shelfName(m.shelf)}
      </td>
      <td className={cn(cell, "text-muted-foreground")}>{m.adds[0]}</td>
      <td className={cn(cell, "text-muted-foreground")}>
        {m.egress.length > 0
          ? m.egress.map((e) => e.to).join(", ")
          : "Nothing leaves Sigwald"}
      </td>
      <td className={cell}>
        {known ? (
          <span
            className={cn(
              "er-bracketed font-mono text-[11px] uppercase tracking-[0.08em]",
              on ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {on ? "On" : "Off"}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** What a module makes, in a few words: "tasks and numbers". */
function makesText(m: ModuleManifest): string | null {
  const makes = m.connect?.makes;
  if (!makes?.length) return null;
  const words = makes.map((x) =>
    x === "tasks" ? "tasks" : x === "events" ? "calendar events" : "numbers"
  );
  return words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function ModulePane({
  module: m,
  on,
  known,
}: {
  module: ModuleManifest;
  on: boolean;
  known: boolean;
}) {
  const setOn = useModulesStore((s) => s.setOn);
  const move = useModulesStore((s) => s.move);
  const states = useModulesStore((s) => s.states);
  const Settings = CLIENT_MODULES[m.id].Settings;

  // The rail lists only modules with a page, so that's what a place counts.
  const onIds = useMemo(
    () =>
      states
        .filter((s) => s.on && MODULES.find((x) => x.id === s.id)?.page)
        .map((s) => s.id),
    [states]
  );
  const railIndex = onIds.indexOf(m.id);
  const inRail = Boolean(m.page);
  const makes = makesText(m);

  const toggle = async (next: boolean) => {
    const ok = await setOn(m.id, next);
    if (!ok) {
      toast.error(`Couldn't turn ${m.name} ${next ? "on" : "off"}. Try again.`);
    }
  };

  return (
    <div className="space-y-6 p-5">
      <div className="space-y-2">
        <h2 className="er-display flex items-baseline gap-2.5 text-lg text-foreground">
          {m.name}
          {m.beta ? <BetaTag /> : null}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {m.summary}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-1 text-[13px]">
          <dt className="text-muted-foreground">Shelf</dt>
          <dd className="text-foreground">{shelfName(m.shelf)}</dd>
          <dt className="text-muted-foreground">Made for</dt>
          <dd className="text-foreground">{m.madeFor.join(" · ")}</dd>
          {m.connect ? (
            <>
              <dt className="text-muted-foreground">Reads</dt>
              <dd className="text-foreground">
                {m.connect.service ? (
                  <a
                    href={m.connect.service.homepage}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-border underline-offset-4 hover:text-rust-text"
                  >
                    {m.connect.service.name}
                  </a>
                ) : (
                  "Nothing outside Sigwald"
                )}
              </dd>
            </>
          ) : null}
          {makes ? (
            <>
              <dt className="text-muted-foreground">Makes</dt>
              <dd className="text-foreground">{makes}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {known ? (
        <div className="flex flex-wrap items-center gap-3">
          {on ? (
            <>
              {m.page ? (
                <Button asChild>
                  <Link href={m.page.href}>Open {m.name}</Link>
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void toggle(false)}>
                Turn off
              </Button>
            </>
          ) : (
            <Button onClick={() => void toggle(true)}>Turn on</Button>
          )}
        </div>
      ) : null}

      <PaneSection label="Adds">
        <ul className="space-y-1.5 text-sm text-foreground">
          {m.adds.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </PaneSection>

      <PaneSection label="Keeps">
        <p className="text-sm text-foreground">{m.keeps}</p>
      </PaneSection>

      <PaneSection label="Sends out of Sigwald">
        {m.egress.length === 0 ? (
          <p className="text-sm text-foreground">
            Nothing. Everything it does stays in Sigwald.
          </p>
        ) : (
          <ul className="space-y-3">
            {m.egress.map((e) => (
              <li key={e.to} className="text-sm">
                <p className="font-medium text-foreground">{e.to}</p>
                <p className="text-muted-foreground">
                  {e.sends}. {e.why}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PaneSection>

      {on && inRail && railIndex >= 0 && onIds.length > 1 ? (
        <PaneSection label="Place in the rail">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {railIndex + 1} of {onIds.length}
            </span>
            <Button
              variant="quiet"
              disabled={railIndex === 0}
              onClick={() => void move(m.id, -1)}
            >
              Up
            </Button>
            <Button
              variant="quiet"
              disabled={railIndex === onIds.length - 1}
              onClick={() => void move(m.id, 1)}
            >
              Down
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The #1 module also sits in the bottom bar on a phone.
          </p>
        </PaneSection>
      ) : null}

      {Settings ? (
        m.connect ? (
          // A connector module's pane brings its own sections: account,
          // settings, reading, numbers, what it holds.
          on ? (
            <Settings />
          ) : (
            <PaneSection label="Set up">
              <p className="text-sm text-muted-foreground">
                Turn {m.name} on to connect it and pick its settings.
              </p>
            </PaneSection>
          )
        ) : (
          <PaneSection label="Settings">
            {on ? (
              <Settings />
            ) : (
              <p className="text-sm text-muted-foreground">
                Turn {m.name} on to set it up.
              </p>
            )}
          </PaneSection>
        )
      ) : null}
    </div>
  );
}

/**
 * A module still taking shape. Faint stencil caps beside the name, not a
 * coloured badge: it's a note about the module, not a status to act on, so it
 * stays out of the rust and out of the State column.
 */
function BetaTag({ className }: { className?: string }) {
  return (
    <span
      title="In beta: it works, but what it does may still change"
      className={cn(
        "font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint",
        className
      )}
    >
      Beta
    </span>
  );
}

function PaneSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="er-label">{label}</h3>
      {children}
    </section>
  );
}
