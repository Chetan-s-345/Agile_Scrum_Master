"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/theme-store";

export function ThemeInit() {
  useEffect(() => {
    useThemeStore.getState().initTheme();
  }, []);

  return null;
}
