"use client";

import { useCallback, useEffect, useState } from "react";

import { format } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SettingRow, SettingsSection } from "./SettingsSection";

interface SubscriptionStatus {
  exists: boolean;
  createdAt?: string;
  lastUsedAt?: string | null;
}

function formatDate(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy");
}

/**
 * Private iCal URL for scheduled tasks and Sigwald-owned calendars.
 * The raw token is shown once after create/rotate and never again.
 */
export function CalendarSubscriptionSettings() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [urlOnce, setUrlOnce] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/calendar/subscription");
      if (!response.ok) throw new Error(String(response.status));
      setStatus((await response.json()) as SubscriptionStatus);
    } catch {
      setStatus({ exists: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createOrReplace = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/calendar/subscription", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Could not create the link");
      const data = (await response.json()) as { url: string };
      setUrlOnce(data.url);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the link"
      );
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!window.confirm("Turn off the subscription link?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/calendar/subscription", {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        throw new Error("Could not turn off the link");
      }
      setUrlOnce(null);
      setStatus({ exists: false });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not turn off the link"
      );
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!urlOnce) return;
    try {
      await navigator.clipboard.writeText(urlOnce);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const replace = async () => {
    if (!window.confirm("The old link stops working.")) return;
    await createOrReplace();
  };

  if (!status) {
    return null;
  }

  const lastUsedLabel =
    status.lastUsedAt == null
      ? "never"
      : formatDate(status.lastUsedAt);

  return (
    <SettingsSection
      title="Subscribe from other calendars"
      description="A private link that shows your scheduled tasks and Sigwald's own calendars in any calendar app. It updates every 15 minutes."
    >
      {!status.exists && !urlOnce ? (
        <SettingRow
          label="Subscription link"
          description="Create a private URL you can paste into Apple Calendar, Google Calendar, Outlook or Thunderbird."
        >
          <Button
            variant="outline"
            onClick={() => void createOrReplace()}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.08em]"
          >
            {busy ? "Creating…" : "Create link"}
          </Button>
        </SettingRow>
      ) : null}

      {urlOnce ? (
        <SettingRow
          label="Your link"
          description="Copy it now; Sigwald won't show it again. Anyone with the link can see your schedule."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              readOnly
              value={urlOnce}
              className="font-mono text-[12px]"
              onFocus={(e) => e.target.select()}
            />
            <Button
              variant="outline"
              onClick={() => void copyUrl()}
              className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              Copy
            </Button>
          </div>
        </SettingRow>
      ) : null}

      {status.exists && !urlOnce ? (
        <SettingRow
          label="Subscription link"
          description={`Created ${formatDate(status.createdAt!)}, last used ${lastUsedLabel}`}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void replace()}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              Replace link
            </Button>
            <Button
              variant="outline"
              onClick={() => void turnOff()}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              Turn off
            </Button>
          </div>
        </SettingRow>
      ) : null}

      {status.exists && urlOnce ? (
        <SettingRow
          label="Manage"
          description="Replace makes a new link; the old one stops working. Turn off removes it."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void replace()}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              Replace link
            </Button>
            <Button
              variant="outline"
              onClick={() => void turnOff()}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              Turn off
            </Button>
          </div>
        </SettingRow>
      ) : null}
    </SettingsSection>
  );
}
