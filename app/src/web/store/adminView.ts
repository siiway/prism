// Session-only team/app authority mode for site administrators.
//
// A site admin holds owner-level authority on every team as the site, and the
// team pages say so with a banner. "Normal view" lets an admin drop that
// override for the session and act as their own team membership instead — the
// api client attaches an `X-Prism-Team-View: member` header while it is on, and
// the worker treats the request as coming from a plain user.
//
// Deliberately NOT persisted: ordinary navigation starts in membership mode.
// Entering a resource from the admin panel explicitly enables the site override.

import { create } from "zustand";

interface AdminViewState {
  /** True while the admin has asked to be treated as their own membership. */
  normalView: boolean;
  /** True once the admin has dismissed the "viewing as a member" banner.
   *  Session-only like the toggle itself; toggling the view brings the
   *  banner back. */
  normalBannerDismissed: boolean;
  adminBannerDismissed: boolean;
  setNormalView: (v: boolean) => void;
  dismissNormalBanner: () => void;
  dismissAdminBanner: () => void;
}

export const useAdminViewStore = create<AdminViewState>((set) => ({
  normalView: true,
  normalBannerDismissed: false,
  adminBannerDismissed: false,
  setNormalView: (v) =>
    set({
      normalView: v,
      normalBannerDismissed: false,
      adminBannerDismissed: false,
    }),
  dismissNormalBanner: () => set({ normalBannerDismissed: true }),
  dismissAdminBanner: () => set({ adminBannerDismissed: true }),
}));

/** Non-hook read for the api client, which runs outside React. */
export function isNormalView(): boolean {
  return useAdminViewStore.getState().normalView;
}
