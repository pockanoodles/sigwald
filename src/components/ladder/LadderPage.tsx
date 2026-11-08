"use client";

import { useEffect } from "react";

import { UrlAsk } from "@/components/navigation/UrlAsk";
import { Button } from "@/components/ui/button";

import { useLadderStore } from "@/store/ladder";

import { BuildDialog } from "./BuildDialog";
import { GoalDialog } from "./GoalDialog";
import { GoalSheet } from "./GoalSheet";
import { HexBand } from "./HexBand";
import { StatSheet } from "./StatSheet";
import { XpLog } from "./XpLog";

/**
 * Stats (the Ladder module): the RPG layer over Sigwald, kept to one page. It
 * never decides what to do next (Today and Focus do that); it reads the work
 * already done as a character sheet for the hex, the two-month block it was
 * done in.
 */
export function LadderPage() {
  const data = useLadderStore((s) => s.data);
  const status = useLadderStore((s) => s.status);
  const error = useLadderStore((s) => s.error);
  const load = useLadderStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  // ← and → step through hexes, as they step the calendar; Esc clears a selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      const s = useLadderStore.getState();
      if (s.buildOpen || s.goalDialog) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        s.step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        s.step(1);
      } else if (e.key === "Escape" && (s.stat || s.goalId)) {
        s.selectStat(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ?goal=…&year=…&index=… (the top bar's search) opens the goal on its own hex.
  const ask = <UrlAsk names={["goal", "year", "index"]} onAsk={openGoal} />;

  if (!data) {
    return (
      <div className="space-y-3 p-6">
        {ask}
        {status === "error" ? (
          <>
            <p className="text-sm text-destructive" role="alert">
              {error}. Try again, and if it keeps failing, Settings has the logs.
            </p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading Stats…</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto xl:overflow-hidden">
      {ask}
      <HexBand data={data} />
      <div className="er-layout-soft grid flex-1 grid-cols-1 xl:min-h-0 xl:grid-cols-[minmax(0,7fr)_minmax(0,6fr)]">
        <div className="border-b border-border xl:min-h-0 xl:border-b-0 xl:border-r">
          <StatSheet data={data} />
        </div>
        <div className="flex flex-col xl:min-h-0">
          <div className="flex flex-col xl:max-h-[58%] xl:min-h-0">
            <GoalSheet data={data} />
          </div>
          <div className="flex min-h-[12rem] flex-1 flex-col xl:min-h-0">
            <XpLog data={data} />
          </div>
        </div>
      </div>
      <BuildDialog />
      <GoalDialog />
    </div>
  );
}

/** Show a goal's hex (unless it's already up), then select the goal. */
function openGoal({
  goal,
  year,
  index,
}: Record<string, string | null>) {
  if (!goal) return;
  const s = useLadderStore.getState();
  const y = Number(year);
  const i = Number(index);
  if (Number.isInteger(y) && Number.isInteger(i) && i >= 1 && i <= 6) {
    const shown = s.hex ?? s.data?.current;
    if (!shown || shown.year !== y || shown.index !== i) {
      const current = s.data?.current;
      s.showHex(current && current.year === y && current.index === i ? null : { year: y, index: i });
    }
  }
  s.selectGoal(goal);
}
