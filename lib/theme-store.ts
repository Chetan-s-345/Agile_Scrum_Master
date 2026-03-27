"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * ThemeStore - global theme state and DOM synchronization.
 *
 * Manages: dark/light theme mode.
 * Consumers: navbar, theme provider, and pages that depend on the root theme class.
 * Persisted: yes, theme value only, to keep preference stable across reloads.
 *
 * Design note: global state avoids hydration drift between isolated components.
 * Update pattern: write store first, then mirror to document root attributes/classes.
 */

type ThemeMode = "dark" | "light";

type ThemeState = {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  initTheme: () => void;
};

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      toggleTheme: () => {
        const next: ThemeMode = get().theme === "dark" ? "light" : "dark";
        set({ theme: next });
        applyTheme(next);
      },
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      initTheme: () => applyTheme(get().theme),
    }),
    {
      name: "sprint-theme",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        // Re-apply after hydration so SSR markup and client preference converge immediately.
        const theme = state?.theme ?? "dark";
        applyTheme(theme);
      },
    }
  )
);
