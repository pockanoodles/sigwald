"use client";

import { ModuleGate } from "@/components/modules/ModuleGate";

export default function ReadoutsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <ModuleGate id="readouts">{children}</ModuleGate>;
}
