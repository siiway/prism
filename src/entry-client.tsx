// Client-side hydration entry. Counterpart to src/entry-server.tsx.
//
// We do NOT call createRoot here — the worker has already streamed the
// rendered HTML, so we hydrate that DOM in place. Initial query cache,
// user profile, and locale are read from window.__INITIAL__ so the first
// useQuery call returns server data without a refetch. Session credentials
// never enter this payload; browser requests use the HttpOnly cookie.

import i18n from "./i18n";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  type DehydratedState,
} from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "./index.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { createRoutes } from "./routes";
import { AuthStoreProvider, authStore } from "./store/auth";
import { api, type SessionUser } from "./lib/api";
import { ApiProvider } from "./lib/ApiProvider";

interface InitialPayload {
  queryState: DehydratedState;
  auth: { user: SessionUser | null } | null;
  locale: string | null;
  colorScheme: "dark" | "light" | null;
}

declare global {
  interface Window {
    __INITIAL__?: InitialPayload;
  }
}

async function start(): Promise<void> {
  const serverInitial = window.__INITIAL__;
  const initial: InitialPayload = serverInitial ?? {
    queryState: { mutations: [], queries: [] } as unknown as DehydratedState,
    auth: null,
    locale: null,
    colorScheme: null,
  };

  if (initial.auth?.user) {
    authStore.getState().setAuth(initial.auth.user);
  } else if (!serverInitial) {
    // The SSR kill switch and emergency fallback return no initial payload.
    // Recover the profile through the cookie without ever reading the JWT.
    try {
      const { user } = await api.me();
      authStore.getState().setAuth(user);
    } catch {
      authStore.getState().clearAuth();
    }
  }

  // Make sure the client picks the language the server rendered with, so the
  // first paint after hydration matches and we don't trigger a re-render.
  if (initial.locale && i18n.language !== initial.locale) {
    await i18n.changeLanguage(initial.locale);
  }

  const qc = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  });

  const router = createBrowserRouter(createRoutes({ qc, api, authStore }));

  hydrateRoot(
    document.getElementById("root")!,
    <StrictMode>
      <QueryClientProvider client={qc}>
        <HydrationBoundary state={initial.queryState}>
          <ApiProvider client={api} origin={window.location.origin}>
            <AuthStoreProvider store={authStore}>
              <ThemeProvider initialColorScheme={initial.colorScheme}>
                <RouterProvider router={router} />
              </ThemeProvider>
            </AuthStoreProvider>
          </ApiProvider>
        </HydrationBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
