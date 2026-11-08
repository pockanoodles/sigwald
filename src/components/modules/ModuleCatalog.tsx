"use client";

import { useCallback, useEffect, useMemo } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { toast } from "sonner";

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

import { MODULES, isModuleId } from "@/modules";
import { CLIENT_MODULES } from "@/modules/client";
import type { ModuleId, ModuleManifest } from "@/modules/types";

import { useModulesStore } from "@/store/modules";

/**
 * The catalog: every module this build ships, as a datasheet, with the
 * selected one shown whole in the reading pane — the same grammar as every
 * other sheet (components/sheet), where a cell truncates and the pane
 * doesn't.
 *
 * Rows stay in catalog order whatever is on, so turning one on never moves
 * the row under your pointer. The rail order is set from the pane.
 */
export function ModuleCatalog() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const states = useModulesStore((s) => s.states);
  const known = useModulesStore((s) => s.known);
  const load = useModulesStore((s) => s.load);

  useEffect(() => {
    void load({ force: true });
  }, [load]);

  const param = searchParams.get("module");
  const selectedId: ModuleId =
    param && isModuleId(param) ? param : MODULES[0].id;
  const selected = MODULES.find((m) => m.id === selectedId) ?? MODULES[0];
  const activeIndex = MODULES.findIndex((m) => m.id === selectedId);

  const select = useCallback(
    (id: ModuleId) => {
      router.replace(`${pathname}?module=${id}`, { scroll: false });
    },
    [pathname, router]
  );

  const isOn = useCallback(
    (id: ModuleId) => known && states.some((s) => s.id === id && s.on),
    [known, states]
  );

  useScrollActiveIntoView([selectedId]);
  const onKeyDown = sheetKeyHandler({
    count: MODULES.length,
    active: activeIndex,
    isSelectable: () => true,
    select: (i) => select(MODULES[i].id),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetLayout
        label="Modules"
        onKeyDown={(e) => void onKeyDown(e)}
        sheet={
          <>
            <table className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 132 }} />
                <col />
                <col style={{ width: 200 }} />
                <col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr>
                  {["#", "Module", "Adds", "Sends data to", "State"].map(
                    (label, i) => (
                      <th
                        key={label}
                        scope="col"
                        className={cn(ROW, HEAD, i === 0 && "text-right")}
                      >
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {MODULES.map((m, i) => (
                  <CatalogRow
                    key={m.id}
                    index={i + 1}
                    module={m}
                    on={isOn(m.id)}
                    known={known}
                    active={m.id === selectedId}
                    onSelect={() => select(m.id)}
                  />
                ))}
              </tbody>
            </table>
            <p className="max-w-2xl px-3 py-4 text-xs leading-relaxed text-muted-foreground">
              Today, Focus, Calendar and Tasks are always there. Modules add to
              them, and you can turn one off at any time: it leaves the rail and
              stops working, and nothing it stored is deleted.
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

  const onIds = useMemo(
    () => states.filter((s) => s.on).map((s) => s.id),
    [states]
  );
  const railIndex = onIds.indexOf(m.id);

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

      {on && railIndex >= 0 && onIds.length > 1 ? (
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
        <PaneSection label="Settings">
          {on ? (
            <Settings />
          ) : (
            <p className="text-sm text-muted-foreground">
              Turn {m.name} on to set it up.
            </p>
          )}
        </PaneSection>
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
