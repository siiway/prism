// Zustand theme-mode store
//
// Persists the user's explicit light/dark preference to localStorage under
// "prism_theme_mode". "system" means no override (follow the OS); it is
// stored as the absence of the key so fresh visitors and reset users share
// the same state. The FOUC shim in index.html reads the same key before
// paint, and ThemeProvider keeps the prism_color_scheme cookie (the value
// SSR renders with) in sync with the *resolved* scheme.

import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "prism_theme_mode";
const isBrowser = typeof localStorage !== "undefined";

function readInitialMode(): ThemeMode {
  if (!isBrowser) return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: readInitialMode(),
  setMode: (mode) => {
    if (isBrowser) {
      if (mode === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    }
    set({ mode });
  },
}));
