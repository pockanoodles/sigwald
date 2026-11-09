"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import { cn } from "@/lib/utils";

interface Proposal {
  id: string;
  title: string;
  dueAt: string;
  evidence: string;
  dueText: string;
  sourceLabel: string;
  sourceUrl: string | null;
  optional: boolean;
  trusted: boolean;
}

const ACTION =
  "er-slash px-2 font-mono text-xs uppercase tracking-wide transition-colors duration-150 disabled:opacity-40";

const dueLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Work Sigwald read out of what you were told (a Canvas announcement or Inbox
 * message) that it wouldn't add on its own: the source isn't one that makes
 * work, the deadline wasn't quoted, or it reads as optional. Each row says
 * where it came from and quotes the words, so it can be judged without
 * opening anything. Add makes it a task; Dismiss means it never comes back.
 * Draws nothing when there's nothing to review.
 */
export function IntakeReview({ onAdded }: { onAdded: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sigwald/intake");
      if (!res.ok) return;
      const json = (await res.json()) as { proposals: Proposal[] };
      setProposals(json.proposals);
    } catch {
      // Review is a convenience on Today; a failed read leaves it as it was.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (p: Proposal, action: "accept" | "dismiss") => {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/sigwald/intake/${p.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setProposals((list) => list.filter((x) => x.id !== p.id));
      if (action === "accept") {
        toast("Added to your tasks");
        onAdded();
      }
    } catch {
      toast("That didn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (proposals.length === 0) return null;

  return (
    <section aria-label="To review" className="border-b border-border bg-surface/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:px-6">
        <span className="er-label">To review</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{proposals.length}</span>
        <span className="truncate text-xs text-muted-foreground">read from your courses, not added yet</span>
      </div>
      <ul>
        {proposals.map((p) => (
          <li key={p.id} className="flex items-start gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0 md:px-6">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{p.title}</span>
                {p.optional ? (
                  <span className="er-bracketed flex-none font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Optional
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <span className="font-mono tabular-nums text-foreground">{dueLabel(p.dueAt)}</span>
                <span aria-hidden>·</span>
                {p.sourceUrl ? (
                  <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
                    {p.sourceLabel}
                  </a>
                ) : (
                  <span className="truncate">{p.sourceLabel}</span>
                )}
              </span>
              <span className="mt-1 block truncate text-xs italic text-muted-foreground" title={`“${p.evidence}” (due: “${p.dueText}”)`}>
                “{p.evidence}”
              </span>
            </span>
            <span className="flex flex-none items-center pt-0.5">
              <button
                type="button"
                disabled={busy === p.id}
                onClick={() => void decide(p, "accept")}
                className={cn(ACTION, "text-foreground hover:text-rust-text")}
              >
                Add
              </button>
              <button
                type="button"
                disabled={busy === p.id}
                onClick={() => void decide(p, "dismiss")}
                className={cn(ACTION, "text-muted-foreground hover:text-foreground")}
              >
                Dismiss
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
