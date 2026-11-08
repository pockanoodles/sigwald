"use client";

import { useEffect } from "react";

import { AppBottomBar } from "@/components/navigation/AppBottomBar";
import { AppNav } from "@/components/navigation/AppNav";
import { AppTopBar } from "@/components/navigation/AppTopBar";
import { PrivacyProvider } from "@/components/providers/PrivacyProvider";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { SetupCheck } from "@/components/setup/SetupCheck";
import { CommandPalette } from "@/components/ui/command-palette";
import { ShortcutsModal } from "@/components/ui/shortcuts-modal";
import { Toaster } from "@/components/ui/sonner";

import { usePageTitle } from "@/hooks/use-page-title";

import { useCommandPaletteStore } from "@/store/commandPalette";
import { useShortcutsStore } from "@/store/shortcuts";

import "../globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const {
    isOpen: commandPaletteOpen,
    setOpen: setCommandPaletteOpen,
    toggle: toggleCommandPalette,
  } = useCommandPaletteStore();
  const { isOpen: shortcutsOpen, setOpen: setShortcutsOpen } =
    useShortcutsStore();

  // Use the page title hook
  usePageTitle();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
      } else if (e.key === "?" && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setShortcutsOpen, toggleCommandPalette]);

  return (
    // Column, not row: the top bar spans the full window above the rail, so
    // the rail and the page are a row *inside* it. `min-h-0` on that row is
    // load-bearing — without it a flex child defaults to min-content height
    // and `main`'s own scrolling stops working.
    <div className="app-sharp flex h-dvh flex-col">
      <SessionProvider>
        <PrivacyProvider>
          <SetupCheck />
          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
          />
          <ShortcutsModal
            isOpen={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
          />
          <AppTopBar />
          <div className="flex min-h-0 flex-1">
            <AppNav />
            <main className="relative min-w-0 flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
          <AppBottomBar />
          <Toaster />
        </PrivacyProvider>
      </SessionProvider>
    </div>
  );
}
