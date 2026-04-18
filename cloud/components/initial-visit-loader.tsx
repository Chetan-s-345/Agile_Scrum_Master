"use client";

import { useEffect, useState } from "react";
import { BlockLoadingOverlay } from "@/components/block-loading-overlay";

const LOADER_SEEN_KEY = "asm.initial.loader.seen.v1";

export function InitialVisitLoader() {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(LOADER_SEEN_KEY) !== "1";
  });

  useEffect(() => {
    if (!active) return;

    window.sessionStorage.setItem(LOADER_SEEN_KEY, "1");
    const timer = window.setTimeout(() => setActive(false), 1200);
    return () => window.clearTimeout(timer);
  }, [active]);

  return <BlockLoadingOverlay active={active} label="Preparing workspace..." fullScreen={true} delayMs={0} />;
}
