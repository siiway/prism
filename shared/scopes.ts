// The platform OAuth scope vocabulary, shared by the Worker and the frontend.
//
// One list in one place. App-scope validation (routes/apps.ts), the OAuth
// authorize/consent path (routes/oauth.ts), personal access tokens
// (routes/user.ts), OIDC discovery (routes/wellknown.ts) and the app
// permissions picker (src/pages/apps/AppDetail.tsx) all derive from it, so a
// new scope is added exactly once.

export const PLATFORM_SCOPES: string[] = [
  "openid",
  "profile",
  "profile:write",
  "email",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "gpg:read",
  "gpg:write",
  "social:read",
  "social:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
  "site:user:read",
  "site:user:write",
  "site:user:delete",
  "site:team:read",
  "site:team:write",
  "site:team:delete",
  "site:config:read",
  "site:config:write",
  "site:token:revoke",
  "team:read",
  "team:write",
  "team:delete",
  "team:member:read",
  "team:member:write",
  "team:member:profile:read",
  "offline_access",
];

/** Scopes an app may request directly. Bound team scopes (`team:<id>:...`)
 *  are validated separately against the team the token is bound to — see
 *  UNBOUND_TEAM_SCOPES in worker/lib/scopes.ts. */
export const APP_REQUESTABLE_SCOPES: string[] = PLATFORM_SCOPES.filter(
  (s) => !s.startsWith("team:"),
);

/** Scopes a user can grant from their own account: the vocabulary minus the
 *  site-admin and team-bound families, which are only ever issued to apps.
 *  This is what a personal access token may carry, and what OIDC discovery
 *  advertises as supported. */
export const USER_GRANTABLE_SCOPES: string[] = PLATFORM_SCOPES.filter(
  (s) => !s.startsWith("site:") && !s.startsWith("team:"),
);
