"use client";

import { useEffect, useMemo, useState } from "react";

import {
  AccountManager,
  type IntegrationStatus,
} from "@/components/settings/AccountManager";
import { AutoScheduleSettings } from "@/components/settings/AutoScheduleSettings";
import { BackupSettings } from "@/components/settings/BackupSettings";
import { CalendarSettings } from "@/components/settings/CalendarSettings";
import { CalendarSubscriptionSettings } from "@/components/settings/CalendarSubscriptionSettings";
import { ImportExportSettings } from "@/components/settings/ImportExportSettings";
import { LogViewer } from "@/components/settings/LogViewer";
import { SystemSettings } from "@/components/settings/SystemSettings";
import { TaskSyncSettings } from "@/components/settings/TaskSyncSettings";
import { UserManagement } from "@/components/settings/UserManagement";
import { UserSettings } from "@/components/settings/UserSettings";

import { cn } from "@/lib/utils";

import { useAdmin } from "@/hooks/use-admin";
import { useResource } from "@/hooks/use-resource";

import { useSettingsStore } from "@/store/settings";

type SettingsTab =
  | "accounts"
  | "user"
  | "calendar"
  | "auto-schedule"
  | "system"
  | "task-sync"
  | "logs"
  | "user-management"
  | "import-export";

/** Settings as a normal page: a quiet side index and one section at a time,
 *  using the same plate grammar as the rest of the app. */
export default function SettingsPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const { isAdmin, isLoading: isAdminLoading } = useAdmin();
  const { initializeSettings } = useSettingsStore();
  // The desktop app has one local user: System holds only a server's own
  // Google and Outlook apps (the desktop signs in through Sigwald's) and the
  // signed-out homepage, and Users manages other people. Both stay off its
  // index.
  const desktop =
    useResource<IntegrationStatus>("/api/integration-status").data?.desktop ??
    false;

  useEffect(() => {
    initializeSettings();
  }, [initializeSettings]);

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: "accounts", label: "Accounts" },
      { id: "user", label: "User" },
      { id: "calendar", label: "Calendar" },
      { id: "auto-schedule", label: "Auto-Schedule" },
      { id: "task-sync", label: "Task Sync" },
      { id: "import-export", label: "Import / Export" },
    ] as const;

    if (desktop) {
      const local = baseTabs.map((tab) =>
        tab.id === "import-export" ? { ...tab, label: "Backups" } : tab
      );
      return isAdmin ? [...local, { id: "logs", label: "Logs" } as const] : local;
    }

    if (isAdmin) {
      const adminTabs = [
        { id: "system", label: "System" },
        { id: "logs", label: "Logs" },
        { id: "user-management", label: "Users" },
      ] as const;

      return [...baseTabs, ...adminTabs] as const;
    }

    return baseTabs;
  }, [isAdmin, desktop]);

  const [activeTab, setActiveTab] = useState<SettingsTab>("accounts");

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) as SettingsTab;

      const allPossibleTabIds: SettingsTab[] = [
        "accounts",
        "user",
        "calendar",
        "auto-schedule",
        "task-sync",
        "system",
        "logs",
        "user-management",
        "import-export",
      ];

      if (allPossibleTabIds.includes(hash)) {
        setActiveTab(hash);
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      window.location.hash = activeTab;
    }
  }, [activeTab, isHydrated]);

  const renderContent = () => {
    const adminOnlyTabs = [
      "system",
      "logs",
      "user-management",
      "waitlist",
      "admin-dashboard",
    ];

    if (adminOnlyTabs.includes(activeTab) && isAdminLoading) {
      return (
        <div className="flex flex-col items-start justify-center py-10">
          <p className="er-label">Checking access…</p>
        </div>
      );
    }

    if (adminOnlyTabs.includes(activeTab) && !isAdmin) {
      return (
        <div className="flex flex-col items-start justify-center space-y-2 py-10">
          <h2 className="er-display text-[13px] tracking-[0.12em] text-foreground">
            Admin access required
          </h2>
          <p className="text-[13px] text-muted-foreground">
            You need administrator privileges to open this section.
          </p>
        </div>
      );
    }

    switch (activeTab) {
      case "accounts":
        return <AccountManager />;
      case "user":
        return <UserSettings />;
      case "calendar":
        return (
          <div className="space-y-12">
            <CalendarSettings />
            <CalendarSubscriptionSettings />
          </div>
        );
      case "auto-schedule":
        return <AutoScheduleSettings />;
      case "task-sync":
        return <TaskSyncSettings />;
      case "system":
        return <SystemSettings />;
      case "logs":
        return <LogViewer />;
      case "user-management":
        return <UserManagement />;
      case "import-export":
        // BackupSettings renders only in the desktop app.
        return (
          <div className="space-y-12">
            <BackupSettings />
            <ImportExportSettings />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[72rem] flex-col px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex-none space-y-1.5 md:mb-8">
        <p className="er-label">Preferences</p>
        <h1 className="er-display text-[clamp(1.25rem,2vw,1.5rem)] tracking-[0.08em] text-foreground">
          Settings
        </h1>
        <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Accounts, display, calendars and the quiet switches that keep Sigwald
          pointed at your day.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-8 lg:flex-row lg:gap-12">
        <aside className="w-full flex-none lg:w-44">
          <nav
            aria-label="Settings sections"
            className="flex gap-1 overflow-x-auto border-b border-border pb-px lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0"
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab(tab.id as SettingsTab);
                  }}
                  className={cn(
                    "flex h-9 flex-none items-center whitespace-nowrap px-2.5 text-[13px] transition-colors duration-150",
                    !isHydrated && "duration-0",
                    active
                      ? "er-brackets font-medium text-foreground [--bracket:var(--er-ink)]"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground"
                  )}
                >
                  {tab.label}
                </a>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "er-layout-soft max-w-3xl space-y-8 transition-opacity duration-ui ease-field",
              isHydrated ? "opacity-100" : "opacity-0"
            )}
          >
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
