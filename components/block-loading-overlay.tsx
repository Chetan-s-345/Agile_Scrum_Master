"use client";

import { useEffect, useState } from "react";

type BlockLoadingOverlayProps = {
  active: boolean;
  label?: string;
  fullScreen?: boolean;
  delayMs?: number;
};

export function BlockLoadingOverlay({
  active,
  label = "Loading...",
  fullScreen = true,
  delayMs = 300,
}: BlockLoadingOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setVisible(true), Math.max(0, delayMs));
    return () => {
      window.clearTimeout(timer);
      setVisible(false);
    };
  }, [active, delayMs]);

  if (!visible) return null;

  const overlayClass = fullScreen
    ? "fixed inset-0 z-[120]"
    : "absolute inset-0 z-40 rounded-lg";

  return (
    <div
      className={`${overlayClass} flex items-center justify-center backdrop-blur-sm`}
      style={{ backgroundColor: "color-mix(in srgb, var(--bg-app) 82%, transparent)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="asm-block-loader" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold tracking-wide text-[var(--text-primary)]">Sprint</p>
          <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        </div>
      </div>
    </div>
  );
}
