"use client";

import { brand } from "@/lib/brand";
import { useRef, useState } from "react";

import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { SettingRow, SettingsSection } from "./SettingsSection";

type ReconnectItem =
  | { kind: "account"; provider: string; email: string }
  | { kind: "provider"; type: string; name: string };

type ImportSuccess = {
  counts: Record<string, number>;
  reconnect: ReconnectItem[];
};

export function ImportExportSettings() {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAccountImporting, setIsAccountImporting] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [accountImportResult, setAccountImportResult] =
    useState<ImportSuccess | null>(null);
  const [accountImportError, setAccountImportError] = useState<string | null>(
    null
  );
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseConfirm, setEraseConfirm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accountFileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/export/tasks?includeCompleted=${includeCompleted}`
      );

      if (!response.ok) {
        throw new Error("Failed to export tasks");
      }

      const data = await response.json();

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${brand.slug}-tasks-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Tasks exported successfully");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export tasks");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);

    try {
      const reader = new FileReader();

      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const data = JSON.parse(content);

          const response = await fetch("/api/import/tasks", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Import failed");
          }

          const result = await response.json();
          toast.success(`Import successful: ${result.imported} tasks imported`);
        } catch (error) {
          console.error("Import processing error:", error);
          toast.error(
            `Import failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }
      };

      reader.onerror = () => {
        toast.error("Failed to read the file");
        setIsImporting(false);
      };

      reader.readAsText(file);
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import tasks");
      setIsImporting(false);
    }
  };

  const handleAccountImport = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAccountImporting(true);
    setAccountImportResult(null);
    setAccountImportError(null);

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/import/account", {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        counts?: Record<string, number>;
        reconnect?: ReconnectItem[];
      };
      if (!response.ok) {
        const message = data.error ?? "Import failed";
        if (response.status === 409) {
          setAccountImportError(message);
        } else {
          toast.error(message);
          setAccountImportError(message);
        }
        return;
      }
      setAccountImportResult({
        counts: data.counts ?? {},
        reconnect: data.reconnect ?? [],
      });
      toast.success("Import finished");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Import failed"
      );
    } finally {
      setIsAccountImporting(false);
      if (accountFileRef.current) accountFileRef.current.value = "";
    }
  };

  const handleErase = async () => {
    setIsErasing(true);
    try {
      const response = await fetch("/api/account/erase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: eraseConfirm }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Erase failed");
      }
      setEraseOpen(false);
      setEraseConfirm("");
      toast.success("Account data erased");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erase failed");
    } finally {
      setIsErasing(false);
    }
  };

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Your data"
        description="Everything you have in Sigwald in one file: tasks, goals, courses, shifts, people, training, nutrition and settings. Passwords and connected-account tokens are left out."
      >
        <SettingRow
          label="Download"
          description="A gzipped Sigwald file for this account."
        >
          <Button asChild variant="outline">
            <a
              href="/api/export/account"
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              <Download className="h-4 w-4" />
              Download everything
            </a>
          </Button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Import"
        description="Loads a Sigwald file into this account. The account must be empty."
      >
        <SettingRow
          label="File"
          description="Choose a .sigwald export, then import."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                ref={accountFileRef}
                type="file"
                accept=".sigwald,application/gzip"
                onChange={(e) => void handleAccountImport(e)}
                disabled={isAccountImporting}
                className="max-w-sm"
              />
              <Button
                type="button"
                variant="outline"
                disabled={isAccountImporting}
                onClick={() => accountFileRef.current?.click()}
                className="font-mono text-[11px] uppercase tracking-[0.08em]"
              >
                {isAccountImporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Import
              </Button>
            </div>
            {accountImportError ? (
              <p className="text-[13px] text-destructive" role="status">
                {accountImportError}
              </p>
            ) : null}
            {accountImportResult ? (
              <div className="space-y-2 text-[13px] text-muted-foreground">
                <p>
                  Imported{" "}
                  {Object.entries(accountImportResult.counts)
                    .map(([model, n]) => `${n} ${model}`)
                    .join(", ") || "nothing"}
                  .
                </p>
                {accountImportResult.reconnect.length > 0 ? (
                  <div>
                    <p className="text-foreground">Reconnect these accounts:</p>
                    <ul className="list-disc pl-5">
                      {accountImportResult.reconnect.map((item, i) => (
                        <li key={i}>
                          {item.kind === "account"
                            ? `${item.provider} (${item.email})`
                            : `${item.type} (${item.name})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Erase my data"
        description="Deletes everything in this account except your sign-in. This can't be undone; download a copy first."
      >
        <SettingRow
          label="Erase"
          description="Type erase my data to confirm."
        >
          {eraseOpen ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={eraseConfirm}
                onChange={(e) => setEraseConfirm(e.target.value)}
                placeholder="erase my data"
                className="max-w-xs"
                disabled={isErasing}
              />
              <Button
                variant="destructive"
                disabled={isErasing || eraseConfirm !== "erase my data"}
                onClick={() => void handleErase()}
                className="font-mono text-[11px] uppercase tracking-[0.08em]"
              >
                {isErasing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Erase
              </Button>
              <Button
                variant="quiet"
                disabled={isErasing}
                onClick={() => {
                  setEraseOpen(false);
                  setEraseConfirm("");
                }}
                className="font-mono text-[11px] uppercase tracking-[0.08em]"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="destructive"
              onClick={() => setEraseOpen(true)}
              className="font-mono text-[11px] uppercase tracking-[0.08em]"
            >
              Erase my data
            </Button>
          )}
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Tasks only (Fluid Calendar format)"
        description="Export your tasks to a file or import tasks from a file."
      >
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="includeCompleted"
              checked={includeCompleted}
              onCheckedChange={(checked) =>
                setIncludeCompleted(checked as boolean)
              }
            />
            <Label htmlFor="includeCompleted">Include completed tasks</Label>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Button
              onClick={() => void handleExport()}
              disabled={isExporting}
              className="flex items-center gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export Tasks
            </Button>

            <Button
              onClick={handleImportClick}
              disabled={isImporting}
              variant="outline"
              className="flex items-center gap-2"
            >
              {isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import Tasks
            </Button>

            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => void handleFileChange(e)}
              accept=".json"
              className="hidden"
            />
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              <strong>Export:</strong> Creates a JSON file containing all your
              tasks, projects, and tags.
            </p>
            <p>
              <strong>Import:</strong> Imports tasks, projects, and tags from a
              JSON file. Tasks will be associated with your account.
            </p>
            <p className="text-warning">
              Note: Importing will not delete or modify your existing tasks, but
              may create duplicates if tasks with similar titles exist.
            </p>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
