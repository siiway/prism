// Route tree as a factory: createRoutes(ctx) returns the same RouteObject[]
// for both client and server, but with closures that hold the request-scoped
// QueryClient and auth state. This lets loaders prefetch and check auth
// without a global "current request" singleton.
//
// Lazy-loaded route components (`lazy: () => import(...)`) keep the initial
// JS payload small — the entry bundle only ships the router, providers, and
// the route-tree skeleton; each page's code arrives on demand (and is fetched
// alongside the SSR HTML for first paint).

import { redirect, type RouteObject } from "react-router-dom";
import type { QueryClient } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { useAuthStore } from "./store/auth";
import { api, type UserProfile } from "./lib/api";

// Eager imports for the auth-callback handler (tiny, used post-login redirect)
// and NotFound (needed to know its route id at static-handler time).
import { AuthCallback } from "./components/Guards";
import { NotFound } from "./pages/NotFound";
import { Unauthorized } from "./pages/Unauthorized";
import { ErrorElement } from "./components/ErrorElement";

export interface RouteContext {
  qc: QueryClient;
  /** Server: cookie-derived auth payload. Client: null (read from store). */
  auth: { token: string | null; user: UserProfile | null } | null;
  /** Distinguishes the server build of these routes from the client one. */
  isClient: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAuth(ctx: RouteContext): {
  token: string | null;
  user: UserProfile | null;
} {
  // On the client, always read live state — login/logout/refresh updates it.
  // On the server, the closure holds this request's auth (no shared state).
  if (ctx.isClient) {
    const s = useAuthStore.getState();
    return { token: s.token, user: s.user };
  }
  return ctx.auth ?? { token: null, user: null };
}

function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return redirect(`/login?redirect=${encodeURIComponent(next)}`);
}

/** Prefetch a query if not already cached. Errors are swallowed so a flaky
 * upstream doesn't hard-fail the SSR pass; the client useQuery will retry. */
async function prefetch(
  qc: QueryClient,
  queryKey: unknown[],
  queryFn: () => Promise<unknown>,
): Promise<void> {
  if (qc.getQueryData(queryKey) !== undefined) return;
  try {
    await qc.prefetchQuery({ queryKey, queryFn });
  } catch {
    /* swallow — client will refetch */
  }
}

// ─── Route factory ───────────────────────────────────────────────────────────

export function createRoutes(ctx: RouteContext): RouteObject[] {
  const requireAuthLoader = (request: Request) => {
    const auth = getAuth(ctx);
    if (!auth.token) throw loginRedirect(request);
    return auth;
  };

  const requireAdminLoader = (request: Request) => {
    const auth = requireAuthLoader(request);
    if (auth.user?.role !== "admin") throw redirect("/");
    return auth;
  };

  // The /login (and /register) route should bounce already-logged-in users
  // home, and bounce the platform to /init when not yet set up. Two exceptions
  // keep the login form visible for a visitor who is already signed in:
  //   - `?reauth=1` (OIDC prompt=login / max_age): re-authenticate for a
  //     pending authorization request.
  //   - `?add=1` (account switcher): sign in as an additional account.
  const publicAuthLoader = async ({ request }: { request: Request }) => {
    await prefetch(ctx.qc, ["site"], api.site);
    const site = ctx.qc.getQueryData<{ initialized?: boolean }>(["site"]);
    if (site && site.initialized === false) throw redirect("/init");
    const params = new URL(request.url).searchParams;
    const skipBounce =
      params.get("reauth") === "1" || params.get("add") === "1";
    if (getAuth(ctx).token && !skipBounce) throw redirect("/");
    return null;
  };

  return [
    // ── Public ──────────────────────────────────────────────────────────────
    {
      path: "/init",
      errorElement: <ErrorElement />,
      lazy: () => import("./pages/Init").then((m) => ({ Component: m.Init })),
    },
    {
      path: "/login",
      loader: publicAuthLoader,
      errorElement: <ErrorElement />,
      lazy: () => import("./pages/Login").then((m) => ({ Component: m.Login })),
    },
    {
      path: "/register",
      loader: publicAuthLoader,
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/Register").then((m) => ({ Component: m.Register })),
    },
    {
      // Standalone, team-branded registration entry. Deliberately not behind
      // publicAuthLoader: an already-signed-in visitor should still be able
      // to read the page and be pointed at the ordinary join flow.
      path: "/join/:teamId",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/JoinRegister").then((m) => ({
          Component: m.JoinRegister,
        })),
    },
    { path: "/auth/callback", element: <AuthCallback /> },
    {
      path: "/auth/tg-callback",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/TgAuthCallback").then((m) => ({
          Component: m.TgAuthCallback,
        })),
    },
    {
      path: "/social-confirm",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/SocialConfirm").then((m) => ({
          Component: m.SocialConfirm,
        })),
    },
    {
      path: "/social-select",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/SocialSelect").then((m) => ({
          Component: m.SocialSelect,
        })),
    },
    {
      path: "/social-2fa",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/Social2fa").then((m) => ({
          Component: m.Social2fa,
        })),
    },

    // ── Email verification ──────────────────────────────────────────────────
    {
      path: "/verify-email",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/VerifyEmail").then((m) => ({
          Component: m.VerifyEmail,
        })),
    },
    {
      path: "/verify-choose",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/VerifyChoose").then((m) => ({
          Component: m.VerifyChoose,
        })),
    },

    // ── Team invite ─────────────────────────────────────────────────────────
    {
      path: "/teams/join/:token",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/teams/TeamJoin").then((m) => ({
          Component: m.TeamJoin,
        })),
    },

    // ── OAuth consent ───────────────────────────────────────────────────────
    {
      path: "/oauth/authorize",
      loader: ({ request }) => {
        requireAuthLoader(request);
        return null;
      },
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/oauth/Authorize").then((m) => ({
          Component: m.Authorize,
        })),
    },
    {
      path: "/oauth/2fa",
      loader: ({ request }) => {
        requireAuthLoader(request);
        return null;
      },
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/oauth/Verify2FA").then((m) => ({
          Component: m.Verify2FA,
        })),
    },
    {
      // RFC 8628 device verification — requires an authenticated user (the
      // page bounces to /login when the session is missing, like /oauth/authorize).
      path: "/device",
      loader: ({ request }) => {
        requireAuthLoader(request);
        return null;
      },
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/oauth/DeviceVerify").then((m) => ({
          Component: m.DeviceVerify,
        })),
    },
    {
      // OIDC RP-Initiated Logout landing page (public — the session is already
      // ended by the time the browser lands here).
      path: "/logged-out",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/LoggedOut").then((m) => ({ Component: m.LoggedOut })),
    },

    // ── Public user/team profiles ───────────────────────────────────────────
    {
      path: "/u/:username",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/PublicProfile").then((m) => ({
          Component: m.PublicProfile,
        })),
    },
    {
      path: "/t/:id",
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/PublicTeam").then((m) => ({
          Component: m.PublicTeam,
        })),
    },

    // ── Legal pages (public, operator-configured) ───────────────────────────
    {
      path: "/privacy",
      loader: async () => {
        await Promise.all([
          prefetch(ctx.qc, ["site"], api.site),
          prefetch(ctx.qc, ["legal", "privacy"], () => api.legal("privacy")),
        ]);
        return null;
      },
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/Legal").then((m) => ({ Component: m.PrivacyPage })),
    },
    {
      path: "/terms",
      loader: async () => {
        await Promise.all([
          prefetch(ctx.qc, ["site"], api.site),
          prefetch(ctx.qc, ["legal", "terms"], () => api.legal("terms")),
        ]);
        return null;
      },
      errorElement: <ErrorElement />,
      lazy: () =>
        import("./pages/Legal").then((m) => ({ Component: m.TermsPage })),
    },

    // ── Protected app shell ─────────────────────────────────────────────────
    {
      // Element is eager (Layout is on every authenticated page).
      Component: Layout,
      errorElement: <ErrorElement />,
      loader: async ({ request }) => {
        requireAuthLoader(request);
        // Prefetch global state used by Layout's nav.
        await prefetch(ctx.qc, ["site"], api.site);
        return null;
      },
      children: [
        {
          index: true,
          loader: async ({ request }) => {
            requireAuthLoader(request);
            // Dashboard pulls the user's apps + site overview.
            await Promise.all([
              prefetch(ctx.qc, ["apps"], api.listApps),
              prefetch(ctx.qc, ["domains"], api.listDomains),
            ]);
            return null;
          },
          lazy: () =>
            import("./pages/Dashboard").then((m) => ({
              Component: m.Dashboard,
            })),
        },
        {
          path: "profile",
          loader: async ({ request }) => {
            requireAuthLoader(request);
            await prefetch(ctx.qc, ["me"], api.me);
            return null;
          },
          lazy: () =>
            import("./pages/Profile").then((m) => ({ Component: m.Profile })),
        },
        {
          path: "security",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/Security").then((m) => ({
              Component: m.Security,
            })),
        },
        {
          path: "apps",
          loader: async ({ request }) => {
            requireAuthLoader(request);
            await prefetch(ctx.qc, ["apps"], api.listApps);
            return null;
          },
          lazy: () =>
            import("./pages/apps/AppList").then((m) => ({
              Component: m.AppList,
            })),
        },
        {
          path: "apps/:id",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/apps/AppDetail").then((m) => ({
              Component: m.AppDetail,
            })),
        },
        {
          path: "teams",
          loader: async ({ request }) => {
            requireAuthLoader(request);
            await prefetch(ctx.qc, ["teams"], api.listTeams);
            return null;
          },
          lazy: () =>
            import("./pages/teams/TeamList").then((m) => ({
              Component: m.TeamList,
            })),
        },
        {
          path: "teams/:id",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/teams/TeamDetail").then((m) => ({
              Component: m.TeamDetail,
            })),
        },
        {
          path: "domains",
          loader: async ({ request }) => {
            requireAuthLoader(request);
            await prefetch(ctx.qc, ["domains"], api.listDomains);
            return null;
          },
          lazy: () =>
            import("./pages/Domains").then((m) => ({ Component: m.Domains })),
        },
        {
          path: "connections",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/Connections").then((m) => ({
              Component: m.Connections,
            })),
        },
        {
          path: "connected-apps",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/ConnectedApps").then((m) => ({
              Component: m.ConnectedApps,
            })),
        },
        {
          path: "tokens",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/Tokens").then((m) => ({ Component: m.Tokens })),
        },
        {
          path: "notifications",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/Notifications").then((m) => ({
              Component: m.Notifications,
            })),
        },
        {
          path: "audit-log",
          loader: ({ request }) => {
            requireAuthLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/AuditLogPage").then((m) => ({
              Component: m.AuditLogPage,
            })),
        },

        // ── Admin ─────────────────────────────────────────────────────────
        {
          path: "admin",
          loader: ({ request }) => {
            requireAdminLoader(request);
            return null;
          },
          lazy: () =>
            import("./pages/admin/AdminLayout").then((m) => ({
              Component: m.AdminLayout,
            })),
          children: [
            {
              index: true,
              lazy: () =>
                import("./pages/admin/AdminDashboard").then((m) => ({
                  Component: m.AdminDashboard,
                })),
            },
            {
              path: "users",
              lazy: () =>
                import("./pages/admin/AdminUsers").then((m) => ({
                  Component: m.AdminUsers,
                })),
            },
            {
              path: "users/:id",
              lazy: () =>
                import("./pages/admin/AdminUserDetail").then((m) => ({
                  Component: m.AdminUserDetail,
                })),
            },
            {
              path: "apps",
              lazy: () =>
                import("./pages/admin/AdminApps").then((m) => ({
                  Component: m.AdminApps,
                })),
            },
            {
              path: "teams",
              lazy: () =>
                import("./pages/admin/AdminTeams").then((m) => ({
                  Component: m.AdminTeams,
                })),
            },
            {
              path: "settings",
              lazy: () =>
                import("./pages/admin/AdminSettings").then((m) => ({
                  Component: m.AdminSettings,
                })),
            },
            {
              path: "invites",
              lazy: () =>
                import("./pages/admin/AdminInvites").then((m) => ({
                  Component: m.AdminInvites,
                })),
            },
            {
              path: "connections",
              lazy: () =>
                import("./pages/admin/AdminConnections").then((m) => ({
                  Component: m.AdminConnections,
                })),
            },
            {
              path: "audit",
              lazy: () =>
                import("./pages/admin/AdminAudit").then((m) => ({
                  Component: m.AdminAudit,
                })),
            },
            {
              path: "login-errors",
              lazy: () =>
                import("./pages/admin/AdminLoginErrors").then((m) => ({
                  Component: m.AdminLoginErrors,
                })),
            },
            {
              path: "logs",
              lazy: () =>
                import("./pages/admin/AdminLogs").then((m) => ({
                  Component: m.AdminLogs,
                })),
            },
            {
              path: "image-proxy",
              lazy: () =>
                import("./pages/admin/AdminImageProxy").then((m) => ({
                  Component: m.AdminImageProxy,
                })),
            },
            {
              path: "domains",
              lazy: () =>
                import("./pages/admin/AdminDomains").then((m) => ({
                  Component: m.AdminDomains,
                })),
            },
            {
              path: "notices",
              lazy: () =>
                import("./pages/admin/AdminNotices").then((m) => ({
                  Component: m.AdminNotices,
                })),
            },
            {
              path: "scope-grants",
              lazy: () =>
                import("./pages/admin/AdminScopeGrants").then((m) => ({
                  Component: m.AdminScopeGrants,
                })),
            },
            {
              path: "database",
              lazy: () =>
                import("./pages/admin/AdminDatabase").then((m) => ({
                  Component: m.AdminDatabase,
                })),
            },
          ],
        },
      ],
    },

    // ── Unauthorized ───────────────────────────────────────────────────────
    {
      path: "/unauthorized",
      element: <Unauthorized />,
    },

    // ── 404 ─────────────────────────────────────────────────────────────────
    { id: "not-found", path: "*", element: <NotFound /> },
  ];
}
