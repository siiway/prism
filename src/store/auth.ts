// Request-aware Zustand auth store.
//
// Browser authentication is cookie-only: the session JWT lives exclusively in
// the HttpOnly __Host-prism_session cookie. The store holds only the public user
// profile needed to render the UI. Every SSR render creates a separate vanilla
// store so concurrent requests never share identity state.

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { SessionUser } from "../lib/api";

export interface AuthState {
  user: SessionUser | null;
  isLoading: boolean;
  /** Set or refresh the profile for the cookie-authenticated session. */
  setAuth: (user: SessionUser) => void;
  /** Clear the in-memory profile after logout or an invalid session. */
  clearAuth: () => void;
  setLoading: (value: boolean) => void;
}

export type AuthStore = StoreApi<AuthState>;

export interface CreateAuthStoreOptions {
  /** Immutable identity derived from the current SSR request. */
  initialAuth?: { user: SessionUser | null } | null;
}

export function createAuthStore(
  options: CreateAuthStoreOptions = {},
): AuthStore {
  return createStore<AuthState>((set) => ({
    user: options.initialAuth?.user ?? null,
    isLoading: false,
    setAuth: (user) => set({ user }),
    clearAuth: () => set({ user: null }),
    setLoading: (value) => set({ isLoading: value }),
  }));
}

/** The browser's long-lived in-memory store; server renders use a fresh store. */
export const authStore = createAuthStore();

const AuthStoreContext = createContext<AuthStore | null>(null);

export function AuthStoreProvider({
  store,
  children,
}: {
  store: AuthStore;
  children: ReactNode;
}) {
  return createElement(AuthStoreContext.Provider, { value: store }, children);
}

export function useAuthStore(): AuthState;
export function useAuthStore<T>(selector: (state: AuthState) => T): T;
export function useAuthStore<T>(
  selector?: (state: AuthState) => T,
): AuthState | T {
  const store = useContext(AuthStoreContext) ?? authStore;
  const select = selector ?? ((state: AuthState): AuthState => state);
  return useStore(store, select as (state: AuthState) => AuthState | T);
}
