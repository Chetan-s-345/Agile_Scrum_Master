import { create } from "zustand";

/**
 * UIStore - shared shell UI state.
 *
 * Manages: sidebar open/closed state.
 * Consumers: dashboard layout, navbar toggles, and mobile menu controls.
 * Persisted: no, because UI chrome should reset naturally on navigation/session changes.
 *
 * Design note: centralizing this prevents duplicate local states fighting each other.
 */

type UIState = {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));
