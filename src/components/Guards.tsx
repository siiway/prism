// Auth callback handler used by /auth/callback. Auth-gating for protected
// routes lives in src/routes.tsx as loaders that throw redirect() — that
// gives proper 302s server-side instead of an empty hydrated page.

import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "../store/auth";
import { useApi } from "../lib/api-context";

// The social OAuth response has already installed the HttpOnly session cookie.
// Resolve only the safe user profile; no credential is accepted from the URL or
// exposed to browser JavaScript.
export function AuthCallback() {
  const api = useApi();
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    // Scrub query strings left by pre-fix callback URLs from browser history.
    if (window.location.search || window.location.hash) {
      window.history.replaceState(null, "", "/auth/callback");
    }

    api
      .me()
      .then(({ user }) => {
        setAuth(user);
        navigate("/", { replace: true });
      })
      .catch(() => navigate("/login?error=no_session", { replace: true }));
  }, [api, navigate, setAuth]);

  return null;
}
