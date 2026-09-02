// Auth callback handler used by /auth/callback. Auth-gating for protected
// routes lives in src/routes.tsx as loaders that throw redirect() — that
// gives proper 302s server-side instead of an empty hydrated page.

import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "../store/auth";
import { useApi } from "../lib/api-context";

// Social auth callback handler: /auth/callback?token=...
//
// On a successful social OAuth round-trip the worker has already set a
// session cookie on the redirect, so api.me() authenticates without the
// URL token. We still accept ?token= for back-compat with older flows.
export function AuthCallback() {
  const api = useApi();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const token = params.get("token");

    // Mirror the URL token into localStorage so the legacy Bearer-header
    // path keeps working. The cookie is the source of truth going forward.
    if (token) localStorage.setItem("token", token);

    api
      .me()
      .then(({ user }) => {
        if (token) setAuth(token, user);
        navigate("/");
      })
      .catch(() => {
        if (token) localStorage.removeItem("token");
        navigate(
          token ? "/login?error=invalid_token" : "/login?error=no_token",
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount with the current params
  }, []);

  return null;
}
