// Zustand auth store

import { create } from "zustand";
import type { UserProfile } from "../lib/api";

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  setAuth: (token: string, user: UserProfile) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),
  user: (() => {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserProfile;
    } catch {
      return null;
    }
  })(),
  isLoading: false,

  setAuth: (token, user) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    set({ token, user });
  },

  clearAuth: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ token: null, user: null });
  },

  setLoading: (v) => set({ isLoading: v }),
}));
