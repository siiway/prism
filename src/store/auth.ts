// Zustand auth store
//
// On the server (SSR), localStorage doesn't exist, so the store initializes
// empty. The client-side entry-client.tsx reads window.__INITIAL__.auth and
// calls setAuth() to seed the store before hydration starts, which keeps
// the server-rendered HTML consistent with what the client sees.
//
// The store tracks a single *active* account (token + user, the shape the
// rest of the app already reads) plus a list of every account the user has
// signed into on this device. The account switcher moves the active pointer
// between them; see components/Layout.tsx for the UI and the cookie-sync
// round trip that keeps SSR in step.

import { create } from "zustand";
import type { UserProfile } from "../lib/api";

/** One signed-in account: the session JWT plus its cached profile. */
export interface Account {
  token: string;
  user: UserProfile;
}

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  /** Every account signed in on this device, active one included. */
  accounts: Account[];
  isLoading: boolean;
  /** Sign in / refresh the active account, registering it in the list. */
  setAuth: (token: string, user: UserProfile) => void;
  /** Make an already-stored account active. Returns it, or null if unknown. */
  switchAccount: (userId: string) => Account | null;
  /**
   * Drop one account. If it was the active one, the next stored account is
   * promoted to active. Returns the account that is active afterwards (null
   * when none remain).
   */
  removeAccount: (userId: string) => Account | null;
  /** Sign out of *every* account and wipe stored state. */
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
}

const isBrowser = typeof localStorage !== "undefined";

function readInitialUser(): UserProfile | null {
  if (!isBrowser) return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

function readInitialAccounts(): Account[] {
  if (!isBrowser) return [];
  const raw = localStorage.getItem("accounts");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Account[];
      if (Array.isArray(parsed))
        return parsed.filter((a) => a?.token && a?.user?.id);
    } catch {
      /* fall through to the single-account migration below */
    }
  }
  // Migration: a session created before the switcher shipped has token + user
  // but no accounts array. Seed the list from it so the current account shows
  // up in the switcher without forcing a re-login.
  const token = localStorage.getItem("token");
  const user = readInitialUser();
  return token && user ? [{ token, user }] : [];
}

function persistActive(token: string | null, user: UserProfile | null): void {
  if (!isBrowser) return;
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
  if (user) localStorage.setItem("user", JSON.stringify(user));
  else localStorage.removeItem("user");
}

function persistAccounts(accounts: Account[]): void {
  if (!isBrowser) return;
  if (accounts.length)
    localStorage.setItem("accounts", JSON.stringify(accounts));
  else localStorage.removeItem("accounts");
}

/** Insert or replace the account for this user, keeping list order stable. */
function upsertAccount(
  accounts: Account[],
  token: string,
  user: UserProfile,
): Account[] {
  const idx = accounts.findIndex((a) => a.user.id === user.id);
  if (idx === -1) return [...accounts, { token, user }];
  const next = accounts.slice();
  next[idx] = { token, user };
  return next;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: isBrowser ? localStorage.getItem("token") : null,
  user: readInitialUser(),
  accounts: readInitialAccounts(),
  isLoading: false,

  setAuth: (token, user) => {
    const accounts = upsertAccount(get().accounts, token, user);
    persistActive(token, user);
    persistAccounts(accounts);
    set({ token, user, accounts });
  },

  switchAccount: (userId) => {
    const acc = get().accounts.find((a) => a.user.id === userId);
    if (!acc) return null;
    persistActive(acc.token, acc.user);
    set({ token: acc.token, user: acc.user });
    return acc;
  },

  removeAccount: (userId) => {
    const { user, token, accounts } = get();
    const remaining = accounts.filter((a) => a.user.id !== userId);
    persistAccounts(remaining);
    // Removing a non-active account leaves the active pointer untouched.
    if (user?.id !== userId) {
      set({ accounts: remaining });
      return user && token ? { token, user } : null;
    }
    // The active account is going away — promote whatever remains.
    const next = remaining[0] ?? null;
    persistActive(next?.token ?? null, next?.user ?? null);
    set({
      token: next?.token ?? null,
      user: next?.user ?? null,
      accounts: remaining,
    });
    return next;
  },

  clearAuth: () => {
    persistActive(null, null);
    persistAccounts([]);
    set({ token: null, user: null, accounts: [] });
  },

  setLoading: (v) => set({ isLoading: v }),
}));
