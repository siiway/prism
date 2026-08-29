// Session-only "normal view" toggle for site administrators.
//
// A site admin holds owner-level authority on every team as the site, and the
// team pages say so with a banner. "Normal view" lets an admin drop that
// override for the session and act as their own team membership instead — the
// api client attaches an `X-Prism-Team-View: member` header while it is on, and
// the worker treats the request as coming from a plain user.
//
// Deliberately NOT persisted: a page reload returns to the default admin view,
// so an admin who forgets they toggled it can never get stuck without access to
// a team they don't belong to.

import { create } from "zustand";

interface AdminViewState {
  /** True while the admin has asked to be treated as their own membership. */
  normalView: boolean;
  setNormalView: (v: boolean) => void;
}

export const useAdminViewStore = create<AdminViewState>((set) => ({
  normalView: false,
  setNormalView: (v) => set({ normalView: v }),
}));

/** Non-hook read for the api client, which runs outside React. */
export function isNormalView(): boolean {
  return useAdminViewStore.getState().normalView;
}
