"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ThemeMode = "dark" | "light" | "system";

type ThemeState = {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  initTheme: () => void;
};

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolvedTheme =
    theme === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", resolvedTheme === "dark");
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
        const theme = state?.theme ?? "dark";
        applyTheme(theme);
      },
    }
  )
);
