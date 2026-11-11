"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { needsAccount } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";

import { moduleById } from "@/modules";
import type {
  SettingField,
  SettingValue,
  Settings,
} from "@/modules/connect/spec";
import {
  type ModuleConnectState,
  formatReading,
  modulesUsing,
} from "@/modules/connect/views";
import type { ModuleId } from "@/modules/types";

/**
 * A connector module's part of its marketplace pane, while it's on: the
 * account it reads through, its settings, how its pulls are going, and what
 * it holds. Everything is drawn from its manifest (`connect`), so a new
 * connector module gets this pane without writing one.
 */
export function ConnectPane({ moduleId }: { moduleId: ModuleId }) {
  const manifest = moduleById(moduleId);
  const spec = manifest.connect!;
  const [state, setState] = useState<ModuleConnectState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/connect/modules/${moduleId}`);
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => null))?.error ??
            `Failed (${res.status})`
        );
      setState((await res.json()) as ModuleConnectState);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load");
    }
  }, [moduleId]);

  useEffect(() => {
    setState(null);
    void load();
  }, [load]);

  const pull = useCallback(async () => {
    setPulling(true);
    try {
      const res = await fetch(`/api/connect/modules/${moduleId}/pull`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't pull. Try again.");
        return;
      }
      setState(body.state as ModuleConnectState);
      const outcome = body.outcome as { ok?: boolean; problem?: string } | null;
      if (outcome && !outcome.ok && outcome.problem)
        toast.error(outcome.problem);
    } finally {
      setPulling(false);
    }
  }, [moduleId]);

  if (!state) {
    return (
      <p className="text-sm text-muted-foreground">
        {loadError ? `Couldn't load: ${loadError}` : "Loading…"}
      </p>
    );
  }

  const service = spec.service;
  const connected =
    !service ||
    !needsAccount(service) ||
    (state.connection && !state.connection.error);

  return (
    <div className="space-y-6">
      <Section label="Account">
        <AccountPart
          moduleId={moduleId}
          state={state}
          onChange={load}
          onConnected={pull}
        />
      </Section>

      {spec.settings.length > 0 ? (
        <Section label="Settings">
          <SettingsForm
            moduleId={moduleId}
            fields={spec.settings}
            settings={state.settings}
            onSaved={setState}
          />
        </Section>
      ) : null}

      {spec.everyMinutes > 0 ? (
        <Section label="Reading">
          <PullPart state={state} everyMinutes={spec.everyMinutes} />
          <Button
            variant="outline"
            size="sm"
            disabled={pulling || !connected || state.missing.length > 0}
            onClick={() => void pull()}
          >
            {pulling ? "Reading…" : "Read now"}
          </Button>
        </Section>
      ) : null}

      {spec.makes.includes("readings") && state.readings.length > 0 ? (
        <Section label="Numbers">
          <ReadingsTable state={state} />
        </Section>
      ) : null}

      {spec.makes.some((m) => m === "tasks" || m === "events") ? (
        <Section label="What it holds">
          <HoldsPart state={state} makes={spec.makes} />
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h3 className="er-label">{label}</h3>
      {children}
    </section>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function every(minutes: number): string {
  if (minutes < 60) return `every ${minutes} min`;
  if (minutes < 24 * 60) return `every ${Math.round(minutes / 60)} h`;
  return `every ${Math.round(minutes / (24 * 60))} days`;
}

function AccountPart({
  moduleId,
  state,
  onChange,
  onConnected,
}: {
  moduleId: ModuleId;
  state: ModuleConnectState;
  onChange: () => Promise<void>;
  onConnected: () => Promise<void>;
}) {
  const spec = moduleById(moduleId).connect!;
  const service = spec.service;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!service) {
    return (
      <p className="text-sm text-foreground">
        Nothing to connect.{" "}
        {spec.receives
          ? "Things are sent to its private address; it reaches out to nothing."
          : "It works everything out on this machine, and nothing leaves Sigwald."}
      </p>
    );
  }
  if (!needsAccount(service)) {
    return (
      <p className="text-sm text-foreground">
        No account needed: it reads {service.name} directly, as anyone could.
      </p>
    );
  }

  const others = modulesUsing(service.id).filter((m) => m.id !== moduleId);
  const connection = state.connection;
  const showForm = editing || !connection;

  /** What the form shows: what was typed, over the connection's own non-secret fields. */
  const shown = (): Record<string, string> => {
    const fields: Record<string, string> = {};
    for (const field of service.fields) {
      const kept =
        field.kind === "secret" ? undefined : connection?.fields[field.key];
      const value = values[field.key] ?? kept;
      if (value !== undefined) fields[field.key] = value;
    }
    return fields;
  };

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/connect/connections/${service.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Replacing a token sends the site and email the form still shows.
        body: JSON.stringify({ fields: shown() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setProblem(body?.error ?? "Couldn't connect.");
        return;
      }
      setEditing(false);
      setValues({});
      toast.success(`Connected ${service.name}`);
      await onChange();
      await onConnected();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/connect/connections/${service.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(`Couldn't disconnect ${service.name}.`);
        return;
      }
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {connection ? (
        <div className="space-y-1 text-sm">
          <p className="text-foreground">
            {service.name}: {connection.accountLabel ?? "connected"}
            <span className="text-muted-foreground">
              {" "}
              · checked {ago(connection.verifiedAt)}
            </span>
          </p>
          {connection.error ? (
            <p className="text-destructive">{connection.error}</p>
          ) : null}
          {others.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {others.map((m) => m.name).join(", ")}{" "}
              {others.length === 1 ? "reads" : "read"} through it too.
            </p>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          {service.tokenHelp ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {service.tokenHelp.text}{" "}
              <a
                href={service.tokenHelp.url}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border underline-offset-4 hover:text-rust-text"
              >
                Make one
              </a>
            </p>
          ) : null}
          {service.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`${moduleId}-${field.key}`}>{field.label}</Label>
              <Input
                id={`${moduleId}-${field.key}`}
                type={
                  field.kind === "secret"
                    ? "password"
                    : field.kind === "url"
                      ? "url"
                      : "text"
                }
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                value={shown()[field.key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.key]: e.target.value }))
                }
              />
              {field.help ? (
                <p className="text-xs text-muted-foreground">{field.help}</p>
              ) : null}
            </div>
          ))}
          {problem ? (
            <p className="text-sm text-destructive">{problem}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Sigwald checks it with {service.name} before keeping it, and keeps
            it encrypted. It only reads.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Checking…" : `Connect ${service.name}`}
            </Button>
            {connection ? (
              <Button
                type="button"
                variant="quiet"
                onClick={() => setEditing(false)}
              >
                Keep the current one
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Replace token
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}

function SettingsForm({
  moduleId,
  fields,
  settings,
  onSaved,
}: {
  moduleId: ModuleId;
  fields: readonly SettingField[];
  settings: Settings;
  onSaved: (state: ModuleConnectState) => void;
}) {
  const [draft, setDraft] = useState<Record<string, SettingValue | string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Edits stay until they're saved: Read now and connecting reload the pane
  // without touching them.
  const dirty = Object.keys(draft).length > 0;

  const value = (f: SettingField) =>
    f.key in draft ? draft[f.key] : settings[f.key];
  const set = (key: string, v: SettingValue | string) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/connect/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setProblem(body?.error ?? "Couldn't save.");
        return;
      }
      onSaved(body as ModuleConnectState);
      setDraft({});
      toast.success("Saved. It reads again on its next pass.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields.map((f) => {
        const id = `${moduleId}-setting-${f.key}`;
        const v = value(f);
        if (f.kind === "toggle") {
          return (
            <div key={f.key} className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor={id}>{f.label}</Label>
                {f.help ? (
                  <p className="text-xs text-muted-foreground">{f.help}</p>
                ) : null}
              </div>
              <Switch
                id={id}
                checked={v === true}
                onCheckedChange={(on) => set(f.key, on)}
              />
            </div>
          );
        }
        return (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={id}>
              {f.label}
              {(f.kind === "text" || f.kind === "list") &&
              !f.optional &&
              (Array.isArray(v) ? v.length === 0 : !v) ? (
                <span className="text-muted-foreground"> (needed)</span>
              ) : null}
            </Label>
            {f.kind === "list" ? (
              <Textarea
                id={id}
                rows={3}
                spellCheck={false}
                placeholder={f.placeholder}
                value={Array.isArray(v) ? v.join("\n") : String(v ?? "")}
                onChange={(e) => set(f.key, e.target.value)}
              />
            ) : f.kind === "select" ? (
              <select
                id={id}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={String(v)}
                onChange={(e) => set(f.key, e.target.value)}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  type={f.kind === "number" ? "number" : "text"}
                  min={f.kind === "number" ? f.min : undefined}
                  max={f.kind === "number" ? f.max : undefined}
                  step={f.kind === "number" ? (f.step ?? 1) : undefined}
                  spellCheck={false}
                  placeholder={f.kind === "text" ? f.placeholder : undefined}
                  value={String(v ?? "")}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={cn(f.kind === "number" && "w-28")}
                />
                {f.kind === "number" && f.unit ? (
                  <span className="text-sm text-muted-foreground">
                    {f.unit}
                  </span>
                ) : null}
              </div>
            )}
            {f.help ? (
              <p className="text-xs text-muted-foreground">{f.help}</p>
            ) : null}
          </div>
        );
      })}
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={!dirty || busy}
      >
        {busy ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}

function PullPart({
  state,
  everyMinutes,
}: {
  state: ModuleConnectState;
  everyMinutes: number;
}) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-foreground">
        Last read {ago(state.lastSuccessAt)}
        <span className="text-muted-foreground"> · {every(everyMinutes)}</span>
      </p>
      {state.missing.length > 0 ? (
        <p className="text-muted-foreground">
          Set {state.missing.join(", ")} to start.
        </p>
      ) : state.error ? (
        <p className="text-destructive">{state.error}</p>
      ) : null}
    </div>
  );
}

function ReadingsTable({ state }: { state: ModuleConnectState }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="er-label text-left">
          <th className="pb-1.5 font-normal">Number</th>
          <th className="pb-1.5 text-right font-normal">Now</th>
          <th className="pb-1.5 text-right font-normal">A week ago</th>
        </tr>
      </thead>
      <tbody>
        {state.readings.map((r) => (
          <tr key={r.key} className="border-t border-border">
            <td className="py-1.5 text-foreground">{r.label}</td>
            <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
              {formatReading(r.value, r.unit)}
            </td>
            <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
              {r.weekAgo === null ? "–" : formatReading(r.weekAgo, r.unit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HoldsPart({
  state,
  makes,
}: {
  state: ModuleConnectState;
  makes: readonly string[];
}) {
  const { counts } = state;
  const line = useMemo(
    () =>
      [
        makes.includes("tasks") ? `${counts.open} open` : null,
        makes.includes("tasks") && counts.waiting > 0
          ? `${counts.waiting} waiting for room`
          : null,
        makes.includes("tasks")
          ? `${counts.finishedThisWeek} finished this week`
          : null,
        makes.includes("events") ? `${counts.upcoming} coming up` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [counts, makes]
  );
  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{line}</p>
      {state.items.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border text-[13px]">
          {state.items.slice(0, 12).map((item) => (
            <li key={item.id} className="flex items-baseline gap-3 py-1.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  item.state === "open"
                    ? "text-foreground"
                    : "text-muted-foreground line-through"
                )}
                title={item.title}
              >
                {item.taskId ? (
                  <Link
                    href={`/tasks?task=${encodeURIComponent(item.taskId)}`}
                    className="hover:underline"
                  >
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}
              </span>
              {item.state === "open" && item.kind === "task" && !item.taskId ? (
                <span className="flex-none font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  Waiting
                </span>
              ) : null}
              {item.when ? (
                <span className="flex-none font-mono text-[11px] tabular-nums text-muted-foreground">
                  {new Date(item.when).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : null}
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-none text-muted-foreground hover:text-foreground"
                  title="Open where it lives"
                >
                  ↗
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      )}
    </div>
  );
}
