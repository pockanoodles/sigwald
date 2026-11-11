"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ConnectPane } from "@/modules/connect/components/ConnectPane";

interface Link {
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The Inbox's pane in the marketplace: its private address (made, replaced
 * or turned off here, and shown in full only once), how to send to it, then
 * the connector pane's settings and what it holds.
 */
export function InboxPane() {
  const [link, setLink] = useState<Link | null | undefined>(undefined);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/sigwald/inbox/link");
    if (res.ok) setLink(((await res.json()) as { link: Link | null }).link);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const make = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sigwald/inbox/link", { method: "POST" });
      if (!res.ok) {
        toast.error("Couldn't make the address. Try again.");
        return;
      }
      const body = (await res.json()) as { url: string; link: Link };
      setFresh(body.url);
      setLink(body.link);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sigwald/inbox/link", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't turn the address off.");
        return;
      }
      setFresh(null);
      setLink(null);
    } finally {
      setBusy(false);
    }
  };

  const example = fresh ?? "https://…/api/sigwald/inbox/in/<your address>";

  return (
    <div className="space-y-6">
      <section className="space-y-3 border-t border-border pt-4">
        <h3 className="er-label">Private address</h3>
        {link === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : link ? (
          <p className="text-sm text-foreground">
            Made {new Date(link.createdAt).toLocaleDateString()}
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              {link.lastUsedAt
                ? `last used ${new Date(link.lastUsedAt).toLocaleString()}`
                : "not used yet"}
            </span>
          </p>
        ) : (
          <p className="text-sm text-foreground">
            Anything that can send a web request can add work here: Zapier,
            Make, n8n, a phone shortcut, a script. Whoever has the address can
            send to it, so keep it like a password.
          </p>
        )}
        {fresh ? (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input
                readOnly
                value={fresh}
                onFocus={(e) => e.target.select()}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(fresh)
                    .then(() => toast.success("Copied"));
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Copy it now. Sigwald keeps only a fingerprint of it, so it
              can&apos;t show it again.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            variant={link ? "outline" : "default"}
            size="sm"
            disabled={busy || link === undefined}
            onClick={() => void make()}
          >
            {link ? "Replace the address" : "Make an address"}
          </Button>
          {link ? (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void remove()}
            >
              Turn it off
            </Button>
          ) : null}
        </div>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h3 className="er-label">Sending to it</h3>
        <p className="text-sm text-muted-foreground">
          POST JSON: one item, or{" "}
          <code className="font-mono text-xs">{'{ "items": [...] }'}</code> of
          up to 50. Only <code className="font-mono text-xs">title</code> is
          needed.
        </p>
        <pre className="overflow-x-auto whitespace-pre border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-foreground">
          {`curl -X POST "${example}" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Send Mara the deck",
       "due": "2026-11-20",
       "url": "https://…",
       "priority": "high"}'`}
        </pre>
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {[
              [
                "id",
                "Your own id. Send it again to update it, with done: true to finish it.",
              ],
              ["due", "A day (2026-11-20) or a time with its offset."],
              [
                "start, end",
                "A time instead: it goes on the calendar, busy unless busy: false.",
              ],
              ["url, note", "A link back, and words to read."],
              ["minutes", "How long it takes, for the scheduler."],
              ["priority", "urgent, high, medium or low."],
              ["list", "A group a goal can claim (Clients)."],
            ].map(([field, what]) => (
              <tr key={field} className="border-t border-border">
                <td className="w-24 py-1.5 pr-3 align-top font-mono text-foreground">
                  {field}
                </td>
                <td className="py-1.5 text-muted-foreground">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ConnectPane moduleId="inbox" />
    </div>
  );
}
