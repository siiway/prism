// Plain-language names for OAuth scopes (oauth.scope<Name>Label / Desc), the
// one list behind the approval screen, the device-code screen and Connected
// apps. Scopes without one, such as another app's app:<client>:<perm> scopes,
// fall back to the raw value.

import type { TFunction } from "i18next";

const KEYS: Record<string, string> = {
  openid: "Identity",
  profile: "Profile",
  email: "Email",
  "profile:write": "ProfileWrite",
  offline_access: "Offline",
  "apps:read": "Apps",
  "apps:write": "AppsWrite",
  "teams:read": "Teams",
  "teams:write": "TeamsWrite",
  "teams:create": "TeamsCreate",
  "teams:delete": "TeamsDelete",
  "domains:read": "Domains",
  "domains:write": "DomainsWrite",
  "social:read": "SocialRead",
  "social:write": "SocialWrite",
  "webhooks:read": "WebhooksRead",
  "webhooks:write": "WebhooksWrite",
  "admin:users:read": "AdminUsersRead",
  "admin:users:write": "AdminUsersWrite",
  "admin:users:delete": "AdminUsersDelete",
  "admin:config:read": "AdminConfigRead",
  "admin:config:write": "AdminConfigWrite",
  "admin:invites:read": "AdminInvitesRead",
  "admin:invites:create": "AdminInvitesCreate",
  "admin:invites:delete": "AdminInvitesDelete",
  "admin:webhooks:read": "AdminWebhooksRead",
  "admin:webhooks:write": "AdminWebhooksWrite",
  "admin:webhooks:delete": "AdminWebhooksDelete",
  "site:user:read": "SiteUserRead",
  "site:user:write": "SiteUserWrite",
  "site:user:delete": "SiteUserDelete",
  "site:team:read": "SiteTeamRead",
  "site:team:write": "SiteTeamWrite",
  "site:team:delete": "SiteTeamDelete",
  "site:config:read": "SiteConfigRead",
  "site:config:write": "SiteConfigWrite",
  "site:token:revoke": "SiteTokenRevoke",
};

export interface ScopeLabel {
  label: string;
  desc?: string;
  /** Site-wide power over other people's accounts. */
  site: boolean;
}

export function scopeLabel(t: TFunction, scope: string): ScopeLabel {
  const key = KEYS[scope];
  const site = scope.startsWith("site:") || scope.startsWith("admin:");
  if (!key) return { label: scope, site };
  return {
    label: t(`oauth.scope${key}Label`),
    desc: t(`oauth.scope${key}Desc`),
    site,
  };
}
