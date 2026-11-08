"use client";

import { useEffect, useMemo, useState } from "react";

import { UrlAsk } from "@/components/navigation/UrlAsk";
import {
  HEAD,
  ROW,
  SheetLayout,
  cellClass,
  gutterClass,
  sheetKeyHandler,
  titleCellClass,
  useScrollActiveIntoView,
} from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

import { agoLabel, cadenceLabel, dueLabel } from "@/modules/people/cadence";
import { PersonPane } from "@/modules/people/components/PersonPane";
import { peopleInView, usePeopleStore } from "@/modules/people/store";
import type { PersonRow } from "@/modules/people/types";

const COLUMNS = [
  { label: "#", width: 44 },
  { label: "Name", width: 180 },
  { label: "Org", width: 160 },
  { label: "Role", width: undefined },
  { label: "Every", width: 96 },
  { label: "Last talked", width: 120 },
  { label: "Next", width: 136 },
] as const;

/**
 * The People page: everyone as a datasheet, soonest check-in first, with the
 * selected person whole in the reading pane — the grammar every sheet shares
 * (components/sheet), j/k and arrows included.
 */
export function PeoplePage() {
  const view = usePeopleStore((s) => s.view);
  const people = usePeopleStore((s) => s.people);
  const archived = usePeopleStore((s) => s.archived);
  const status = usePeopleStore((s) => s.status);
  const selected = usePeopleStore((s) => s.selected);
  const select = usePeopleStore((s) => s.select);
  const setView = usePeopleStore((s) => s.setView);
  const load = usePeopleStore((s) => s.load);
  // ?person=… (the top bar's search), held until the people are in.
  const [asked, setAsked] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // "Now" moves with the data, so labels refresh whenever anything reloads.
  const now = useMemo(() => new Date(), [people, archived]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(
    () => peopleInView(view, people, archived, now),
    [view, people, archived, now]
  );
  const person: PersonRow | undefined =
    selected && selected !== "new"
      ? [...people, ...archived].find((p) => p.id === selected)
      : undefined;
  const activeIndex = rows.findIndex((r) => r.id === selected);

  // Open the asked person in a view that lists them: the archive for someone
  // archived, everyone for someone the current view leaves out.
  useEffect(() => {
    if (!asked || status !== "ready") return;
    setAsked(null);
    const isArchived = archived.some((p) => p.id === asked);
    if (isArchived && view !== "archived") setView("archived");
    else if (!isArchived && !rows.some((r) => r.id === asked)) setView("all");
    select(asked);
  }, [asked, status, archived, rows, view, setView, select]);

  useScrollActiveIntoView([selected]);
  const onKeyDown = sheetKeyHandler({
    count: rows.length,
    active: activeIndex,
    isSelectable: () => true,
    select: (i) => select(rows[i].id),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <UrlAsk names={["person"]} onAsk={({ person }) => setAsked(person)} />
      <SheetLayout
        label="People"
        onKeyDown={(e) => void onKeyDown(e)}
        sheet={
          <>
            <table className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]">
              <colgroup>
                {COLUMNS.map((c) => (
                  <col
                    key={c.label}
                    style={c.width ? { width: c.width } : undefined}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map((c, i) => (
                    <th
                      key={c.label}
                      scope="col"
                      className={cn(ROW, HEAD, i === 0 && "text-right")}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <PersonSheetRow
                    key={p.id}
                    index={i + 1}
                    person={p}
                    now={now}
                    active={p.id === selected}
                    onSelect={() => select(p.id)}
                  />
                ))}
              </tbody>
            </table>
            {status === "ready" && rows.length === 0 ? (
              <EmptyState view={view} onAdd={() => select("new")} />
            ) : null}
            {status === "error" ? (
              <p className="p-6 text-sm text-destructive">
                People couldn&apos;t load. Try again in a moment.
              </p>
            ) : null}
          </>
        }
        pane={
          <div className="min-h-0 flex-1 overflow-y-auto">
            {selected === "new" ? (
              <PersonPane key="new" person={null} />
            ) : person ? (
              <PersonPane key={person.id} person={person} />
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                Select someone to see them here.
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}

function PersonSheetRow({
  index,
  person: p,
  now,
  active,
  onSelect,
}: {
  index: number;
  person: PersonRow;
  now: Date;
  active: boolean;
  onSelect: () => void;
}) {
  const next = p.nextCheckIn ? new Date(p.nextCheckIn) : null;
  const overdue = next != null && next.getTime() < now.getTime();
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
        {p.name}
      </td>
      <td className={cn(cell, "text-muted-foreground")}>{p.org}</td>
      <td className={cn(cell, "text-muted-foreground")}>{p.role}</td>
      <td className={cn(cell, "text-muted-foreground")}>
        {p.cadenceDays ? cadenceLabel(p.cadenceDays) : ""}
      </td>
      <td className={cn(cell, "tabular-nums text-muted-foreground")}>
        {agoLabel(p.lastContactAt ? new Date(p.lastContactAt) : null, now)}
      </td>
      <td
        className={cn(
          cell,
          "tabular-nums",
          overdue ? "font-medium text-destructive" : "text-muted-foreground"
        )}
      >
        {dueLabel(next, now)}
      </td>
    </tr>
  );
}

function EmptyState({
  view,
  onAdd,
}: {
  view: "all" | "due" | "archived";
  onAdd: () => void;
}) {
  if (view === "due") {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No one is due a check-in this week.
      </p>
    );
  }
  if (view === "archived") {
    return (
      <p className="p-6 text-sm text-muted-foreground">No one is archived.</p>
    );
  }
  return (
    <div className="max-w-xl space-y-5 p-6 md:p-10">
      <p className="er-label">No one here yet</p>
      <p className="text-lg leading-relaxed text-foreground">
        Add the people you want to keep in touch with. Give someone a cadence
        and Sigwald puts a reach-out in Today when it&apos;s time.
      </p>
      <Button onClick={onAdd}>Add person</Button>
    </div>
  );
}
