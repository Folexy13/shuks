"use client";

import dynamic from "next/dynamic";
import React from "react";
import type { ArtisanMapInnerProps } from "./artisan-map-inner";

const DynamicArtisanMap = dynamic(() => import("./artisan-map-inner"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[540px] w-full items-center justify-center rounded-xl border border-border bg-stone text-sm text-muted"
    >
      Loading neighborhood map...
    </div>
  ),
});

export function ArtisanMap(props: ArtisanMapInnerProps) {
  return <DynamicArtisanMap {...props} />;
}
