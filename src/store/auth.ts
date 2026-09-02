// Request-aware Zustand auth store.
//
// The browser uses one long-lived store backed by localStorage. Every SSR
// render creates a separate vanilla store and supplies it through
// AuthStoreProvider, so concurrent requests never share identity state.

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { UserProfile } from "../lib/api";

/** One signed-in account: the session JWT plus its cached profile. */
export interface Account {
  token: string;
  user: UserProfile;
  /** Epoch ms this account was last made active; drives "last used" sorting. */
  lastUsedAt?: number;
}

export interface AuthState {
  token: string | null;
  user: UserProfile | null;
  /** Every account signed in on this device, active one included. */
  accounts: Account[];
  isLoading: boolean;
  /** Sign in / refresh the active account, registering it in the list. */
  setAuth: (token: string, user: UserProfile) => void;
  /** Make an already-stored account active. Returns it, or null if unknown. */
  switchAccount: (userId: string) => Account | null;
  /** Drop one account without implicitly promoting another account. */
  removeAccount: (userId: string) => void;
  /** Sign out of every account and wipe stored state. */
  clearAuth: () => void;
  setLoading: (value: boolean) => void;
}

export type AuthStore = StoreApi<AuthState>;

export interface CreateAuthStoreOptions {
  /** Immutable identity derived from the current SSR request. */
  initialAuth?: { token: string | null; user: UserProfile | null } | null;
  /** Pass null for SSR. Omit to use browser localStorage when available. */
  storage?: Storage | null;
}

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function readInitialUser(storage: Storage | null): UserProfile | null {
  const raw = storage?.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

function readInitialAccounts(storage: Storage | null): Account[] {
  const raw = storage?.getItem("accounts");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Account[];
      if (Array.isArray(parsed))
        return parsed.filter((account) => account?.token && account?.user?.id);
    } catch {
      /* fall through to the single-account migration below */
    }
  }

  // Migration: older builds stored only one token/user pair.
  const token = storage?.getItem("token");
  const user = readInitialUser(storage);
  return token && user ? [{ token, user }] : [];
}

function persistActive(
  storage: Storage | null,
  token: string | null,
  user: UserProfile | null,
): void {
  if (!storage) return;
  if (token) storage.setItem("token", token);
  else storage.removeItem("token");
  if (user) storage.setItem("user", JSON.stringify(user));
  else storage.removeItem("user");
}

function persistAccounts(storage: Storage | null, accounts: Account[]): void {
  if (!storage) return;
  if (accounts.length) storage.setItem("accounts", JSON.stringify(accounts));
  else storage.removeItem("accounts");
}

/** Insert or replace an account while preserving list order. */
function upsertAccount(
  accounts: Account[],
  token: string,
  user: UserProfile,
): Account[] {
  const entry: Account = { token, user, lastUsedAt: Date.now() };
  const index = accounts.findIndex((account) => account.user.id === user.id);
  if (index === -1) return [...accounts, entry];
  const next = accounts.slice();
  next[index] = entry;
  return next;
}

export function createAuthStore(
  options: CreateAuthStoreOptions = {},
): AuthStore {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const storedToken = storage?.getItem("token") ?? null;
  const storedUser = readInitialUser(storage);
  const token = options.initialAuth ? options.initialAuth.token : storedToken;
  const user = options.initialAuth ? options.initialAuth.user : storedUser;

  return createStore<AuthState>((set, get) => ({
    token,
    user,
    accounts: readInitialAccounts(storage),
    isLoading: false,

    setAuth: (nextToken, nextUser) => {
      const accounts = upsertAccount(get().accounts, nextToken, nextUser);
      persistActive(storage, nextToken, nextUser);
      persistAccounts(storage, accounts);
      set({ token: nextToken, user: nextUser, accounts });
    },

    switchAccount: (userId) => {
      const account = get().accounts.find((item) => item.user.id === userId);
      if (!account) return null;
      const stamped: Account = { ...account, lastUsedAt: Date.now() };
      const accounts = get().accounts.map((item) =>
        item.user.id === userId ? stamped : item,
      );
      persistActive(storage, stamped.token, stamped.user);
      persistAccounts(storage, accounts);
      set({ token: stamped.token, user: stamped.user, accounts });
      return stamped;
    },

    removeAccount: (userId) => {
      const { user: activeUser, accounts } = get();
      const remaining = accounts.filter((item) => item.user.id !== userId);
      persistAccounts(storage, remaining);
      if (activeUser?.id !== userId) {
        set({ accounts: remaining });
        return;
      }
      persistActive(storage, null, null);
      set({ token: null, user: null, accounts: remaining });
    },

    clearAuth: () => {
      persistActive(storage, null, null);
      persistAccounts(storage, []);
      set({ token: null, user: null, accounts: [] });
    },

    setLoading: (value) => set({ isLoading: value }),
  }));
}

/** The browser's long-lived store; server renders never read or mutate it. */
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
