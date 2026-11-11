"use client";

import { useCallback } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  FilterStrip,
  HEAD,
  ROW,
  SheetLayout,
  StripCount,
  cellClass,
  gutterClass,
  sheetKeyHandler,
  titleCellClass,
  useScrollActiveIntoView,
} from "@/components/sheet/sheet";

import { cn } from "@/lib/utils";

import { isModuleId, moduleById } from "@/modules";
import { formatReading } from "@/modules/connect/views";
import type { Readout } from "@/modules/readouts/series";

import { useResource } from "@/hooks/use-resource";

const idOf = (r: Pick<Readout, "module" | "key" | "unit">) =>
  `${r.module}.${r.key}.${r.unit}`;

function moduleName(id: string): string {
  return isModuleId(id) ? moduleById(id).name : id;
}

/** "+41", "−3", "0", or a dash when there's nothing to compare with. */
function changeText(change: number | null, unit: string): string {
  if (change === null) return "–";
  if (change === 0) return "0";
  const body = formatReading(Math.abs(change), unit);
  return `${change > 0 ? "+" : "−"}${body}`;
}

function readAgo(at: string): string {
  const min = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (min < 60) return `${Math.max(min, 0)} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/**
 * Readouts: every number the modules read, one row each, with where it
 * stands and how it moved; the selected one's history, a day per row, in the
 * reading pane.
 */
export function ReadoutsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, loading, error } = useResource<{ readouts: Readout[] }>(
    "/api/sigwald/readouts"
  );
  const readouts = data?.readouts ?? [];
  const param = searchParams.get("readout");
  const selected =
    readouts.find((r) => idOf(r) === param) ?? readouts[0] ?? null;
  const activeIndex = selected ? readouts.indexOf(selected) : -1;

  const select = useCallback(
    (id: string) =>
      router.replace(`${pathname}?readout=${id}`, { scroll: false }),
    [pathname, router]
  );

  useScrollActiveIntoView([selected ? idOf(selected) : null]);
  const onKeyDown = sheetKeyHandler({
    count: readouts.length,
    active: activeIndex,
    isSelectable: () => true,
    select: (i) => select(idOf(readouts[i])),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterStrip>
        <StripCount>
          {loading
            ? "Loading…"
            : `${readouts.length} ${readouts.length === 1 ? "number" : "numbers"} from ${
                new Set(readouts.map((r) => r.module)).size
              } modules`}
        </StripCount>
      </FilterStrip>
      <SheetLayout
        label="Readouts"
        onKeyDown={(e) => void onKeyDown(e)}
        sheet={
          readouts.length === 0 ? (
            <div className="max-w-xl space-y-3 p-6 text-sm text-muted-foreground">
              {error ? (
                <p>The numbers couldn&apos;t load.</p>
              ) : loading ? null : (
                <>
                  <p>
                    No numbers yet. They come from modules that read them, such
                    as Stripe, YouTube, beehiiv, Toggl or Semantic Scholar, a
                    day after you turn one on.
                  </p>
                  <Link
                    href="/modules?shelf=money"
                    className="text-foreground underline decoration-border underline-offset-4 hover:text-rust-text"
                  >
                    Find one in Modules
                  </Link>
                </>
              )}
            </div>
          ) : (
            <table className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]">
              <colgroup>
                <col style={{ width: 44 }} />
                <col />
                <col style={{ width: 112 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 84 }} />
              </colgroup>
              <thead>
                <tr>
                  {[
                    "#",
                    "Number",
                    "Module",
                    "Now",
                    "1 day",
                    "7 days",
                    "30 days",
                    "Read",
                  ].map((label, i) => (
                    <th
                      key={label}
                      scope="col"
                      className={cn(
                        ROW,
                        HEAD,
                        (i === 0 || (i >= 3 && i <= 6)) && "text-right"
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readouts.map((r, i) => {
                  const active =
                    selected !== null && idOf(r) === idOf(selected);
                  const cell = cellClass(active);
                  return (
                    <tr
                      key={idOf(r)}
                      onClick={() => select(idOf(r))}
                      aria-selected={active}
                      data-active-row={active || undefined}
                      className="group cursor-default"
                    >
                      <td className={gutterClass(active)}>{i + 1}</td>
                      <td
                        className={cn(
                          cell,
                          titleCellClass(active),
                          "text-foreground"
                        )}
                      >
                        {r.label}
                      </td>
                      <td className={cn(cell, "text-muted-foreground")}>
                        {moduleName(r.module)}
                      </td>
                      <td
                        className={cn(
                          cell,
                          "text-right font-mono tabular-nums text-foreground"
                        )}
                      >
                        {formatReading(r.value, r.unit)}
                      </td>
                      {[r.change.day1, r.change.day7, r.change.day30].map(
                        (c, j) => (
                          <td
                            key={j}
                            className={cn(
                              cell,
                              "text-right font-mono tabular-nums text-muted-foreground"
                            )}
                          >
                            {changeText(c, r.unit)}
                          </td>
                        )
                      )}
                      <td className={cn(cell, "text-muted-foreground")}>
                        {readAgo(r.at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
        pane={
          <div className="min-h-0 flex-1 overflow-y-auto">
            {selected ? <ReadoutPane readout={selected} /> : null}
          </div>
        }
      />
    </div>
  );
}

function ReadoutPane({ readout: r }: { readout: Readout }) {
  const days = [...r.history].reverse().slice(0, 60);
  return (
    <div className="space-y-5 p-5">
      <div className="space-y-1">
        <p className="er-label">{moduleName(r.module)}</p>
        <h2 className="er-display text-lg text-foreground">{r.label}</h2>
        <p className="font-mono text-2xl tabular-nums text-foreground">
          {formatReading(r.value, r.unit)}
        </p>
        <p className="text-xs text-muted-foreground">Read {readAgo(r.at)}</p>
      </div>
      <section className="space-y-2 border-t border-border pt-4">
        <h3 className="er-label">By day</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="er-label text-left">
              <th className="pb-1.5 font-normal">Day</th>
              <th className="pb-1.5 text-right font-normal">Value</th>
              <th className="pb-1.5 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => {
              const before = days[i + 1];
              return (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1.5 font-mono tabular-nums text-muted-foreground">
                    {d.day}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                    {formatReading(d.value, r.unit)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {before ? changeText(d.value - before.value, r.unit) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {isModuleId(r.module) ? (
        <Link
          href={`/modules?module=${r.module}`}
          className="inline-block text-sm text-foreground underline decoration-border underline-offset-4 hover:text-rust-text"
        >
          {moduleName(r.module)} in Modules
        </Link>
      ) : null}
    </div>
  );
}
