"use client";

import { Suspense } from "react";

import { ReadoutsPage } from "@/modules/readouts/components/ReadoutsPage";

export default function Readouts() {
  return (
    <Suspense fallback={null}>
      <ReadoutsPage />
    </Suspense>
  );
}
