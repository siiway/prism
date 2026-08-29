// ─── Database row types ───────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "user";
  /** 'user' (default) for real humans. 'team' for synthetic rows whose id
   *  matches teams.id — these unify oauth_apps.owner_id so team-owned apps
   *  resolve via the same join as personal apps. Team-kind rows have no
   *  password_hash, no sessions, no social connections, and cannot log in. */
  kind: "user" | "team";
  email_verified: number;
  email_verify_token: string | null;
  is_active: number;
  alt_email_login: number | null;
  access_token_ttl_minutes: number | null;
  refresh_token_ttl_days: number | null;
  /** 0 = private (default), 1 = public — explicit opt-in only. */
  profile_is_public: number;
  /** NULL = follow site default; 0/1 = user-set preference. */
  profile_show_display_name: number | null;
  profile_show_avatar: number | null;
  profile_show_email: number | null;
  profile_show_joined_at: number | null;
  profile_show_gpg_keys: number | null;
  profile_show_authorized_apps: number | null;
  profile_show_owned_apps: number | null;
  profile_show_domains: number | null;
  /** Also gates whether this user is included in any team's public member
   *  list (the setting follows the user across team profiles). */
  profile_show_joined_teams: number | null;
  /** User-supplied markdown shown on the public profile. NULL/empty = no
   *  README. Capped at PROFILE_README_MAX_BYTES on write. Ignored when
   *  profile_readme_source != 'manual'. */
  profile_readme: string | null;
  profile_readme_updated_at: number | null;
  profile_show_readme: number | null;
  /** 'manual' (default) or 'github'. */
  profile_readme_source: string;
  /** JSON. Shape depends on source — for 'github':
   *    { connection_id?: string, github_login: string } */
  profile_readme_source_meta: string | null;
  profile_readme_synced_at: number | null;
  /** User-provided GitHub PAT used as the preferred token when fetching
   *  this user's GitHub README. Plaintext storage matches social_connections. */
  github_readme_token: string | null;
  /** Consecutive 401 ("Bad credentials") count for the per-user PAT.
   *  Auto-cleared at 3; reset on success or rotation. */
  github_readme_token_failures: number;
  /** Team whose invite minted this account. Non-null = restricted account:
   *  resource-creating features are off by default, app authorization and
   *  team membership are confined to this team's subtree. */
  origin_team_id: string | null;
  /** Hashed reference to the invite used, for tracing a leaked link back to
   *  the accounts it created. */
  origin_invite_token: string | null;
  /** 0 while the account exists but has not yet satisfied the team's join
   *  requirements. Pending accounts cannot complete an OAuth authorization
   *  and are reaped if abandoned. */
  origin_join_completed: number;
  /** When the holder converted to an unrestricted account; NULL = still
   *  restricted. `origin_team_id` is kept for traceability but stops
   *  constraining anything — notably, converted accounts are excluded from
   *  the set a team dissolution deletes. */
  converted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface GpgKeyRow {
  id: string;
  user_id: string;
  fingerprint: string;
  key_id: string;
  name: string;
  public_key: string;
  created_at: number;
  last_used_at: number | null;
}

export interface TotpAuthenticatorRow {
  id: string;
  user_id: string;
  name: string;
  secret: string;
  enabled: number;
  created_at: number;
}

export interface TotpRecoveryRow {
  user_id: string;
  backup_codes: string; // JSON string[]
  updated_at: number;
}

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string; // base64url
  counter: number;
  device_type: string;
  backed_up: number;
  transports: string; // JSON string[]
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface OAuthAppRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  icon_url: string | null;
  website_url: string | null;
  client_id: string;
  client_secret: string;
  redirect_uris: string; // JSON string[]
  allowed_scopes: string; // JSON string[]
  optional_scopes: string; // JSON string[]
  is_public: number;
  is_active: number;
  is_verified: number;
  is_official: number;
  is_first_party: number;
  team_id: string | null;
  oidc_fields: string; // JSON string[]
  use_jwt_tokens: number;
  allow_self_manage_exported_permissions: number;
  access_whitelist_enabled: number;
  /** OIDC RP-Initiated Logout allow-list, JSON string[] of exact-match URIs. */
  post_logout_redirect_uris: string;
  /** RFC 7592 registration access token (HMAC-keyed hash), or null. */
  registration_access_token: string | null;
  /** RFC 7591 token_endpoint_auth_method, or null to infer from is_public. */
  token_endpoint_auth_method: string | null;
  /** RFC 7523 private_key_jwt: inline JWK Set (JSON) and/or a JWKS URI. */
  jwks: string | null;
  jwks_uri: string | null;
  /** OIDC Back-Channel Logout notification endpoint, or null. */
  backchannel_logout_uri: string | null;
  created_at: number;
  updated_at: number;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  /** Sub-teams form a forest. NULL = top-level team; otherwise the parent's
   *  id. ON DELETE CASCADE — deleting a parent removes the whole subtree
   *  (see {@link dissolveTeam}). Cycles and depths > MAX_TEAM_DEPTH are
   *  rejected at the API layer. */
  parent_team_id: string | null;
  /** 0 = private (default), 1 = public — explicit owner opt-in only. */
  profile_is_public: number;
  /** NULL = follow site default; 0/1 = team-set preference. */
  profile_show_description: number | null;
  profile_show_avatar: number | null;
  profile_show_owner: number | null;
  profile_show_member_count: number | null;
  profile_show_apps: number | null;
  profile_show_domains: number | null;
  profile_show_members: number | null;
  /** NULL = follow site default (default_team_profile_show_sub_teams);
   *  0/1 = explicit team-set preference. Controls whether the team's public
   *  profile lists its sub-teams. */
  profile_show_sub_teams: number | null;
  /** 1 = members must have at least one TOTP authenticator or passkey
   *  enrolled. Enforced at join time and again whenever a member tries
   *  to remove their last factor. */
  require_2fa: number;
  /** 1 = members must have a verified primary email. */
  require_verified_email: number;
  /** 1 = this team uses member groups (owner-only opt-in, default off).
   *  While 0 every read surface omits groups; the rows themselves are kept
   *  so re-enabling restores the previous assignments. */
  enable_groups: number;
  /** JSON {@link TeamRolePermissions}, or NULL when nothing is overridden.
   *  Owner-only to change — a capability set that the roles it constrains
   *  could edit would be no constraint at all. */
  role_permissions: string | null;
  /** 1 = a site admin has authorised this team to mint accounts through
   *  invite links. Team owners cannot set this; it is the second of the two
   *  doors guarding the channel. */
  invite_registration_granted: number;
  /** The team owner's own switch. Only meaningful while granted = 1. */
  invite_registration_enabled: number;
  /** JSON {@link InviteRegistrationExemptions} — site-level registration
   *  requirements this team's invite path may skip. Site-admin controlled.
   *  NULL = nothing exempted. Captcha, proof-of-work and rate limits are
   *  never exemptible and have no representation here. */
  invite_registration_exemptions: string | null;
  /** 0 = a normal (unrestricted) account may not join via invite link.
   *  Direct adds by an admin bypass this, so hiring staff still works. */
  allow_normal_user_join: number;
  /** Set when a site admin begins the staged dissolution. The row survives
   *  until the reaper finishes clearing accounts — deleting it earlier would
   *  leave origin_team_id dangling with no way to find the work. */
  dissolving_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Site-level registration requirements a team's invite path may skip.
 *  Deliberately narrow: only the checks whose cost scales with the number of
 *  registrations (outbound email) are listed. */
export interface InviteRegistrationExemptions {
  /** Skip the site's `require_email_verification` gate, and the
   *  `default_team_require_verified_email` floor, for this path only. */
  email_verification?: boolean;
}

export interface TeamGroupRow {
  id: string;
  team_id: string;
  /** Stable identifier emitted to downstream apps. Immutable after
   *  creation — see the migration note. */
  slug: string;
  name: string;
  description: string;
  color: string | null;
  /** NULL = follow the team/site/built-in chain for `groups:assign`;
   *  0/1 = per-group exception. Owner-only to change. */
  admin_assignable: number | null;
  created_at: number;
  updated_at: number;
}

export interface TeamMemberGroupRow {
  team_id: string;
  user_id: string;
  group_id: string;
  assigned_at: number;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: "owner" | "co-owner" | "admin" | "member";
  /** NULL = follow user's profile_show_joined_teams; 0/1 = per-team override.
   *  Applies to both directions (hide on user profile + hide from team's
   *  member list). */
  show_on_profile: number | null;
  joined_at: number;
}

export interface OAuthCodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string; // JSON string[]
  code_challenge: string | null;
  code_challenge_method: string | null;
  nonce: string | null;
  /** RFC 8707 resource indicators, JSON string[] or null. */
  resource: string | null;
  /** OIDC auth context captured at consent: the session's auth_time and amr. */
  auth_time: number | null;
  amr: string | null;
  /** The authenticating session id, for the ID token `sid` + back-channel logout. */
  session_id: string | null;
  expires_at: number;
  created_at: number;
}

export interface OAuthDeviceCodeRow {
  device_code: string; // HMAC-keyed hash
  user_code: string; // normalized (uppercase, no hyphen)
  client_id: string;
  scopes: string; // JSON string[]
  resource: string | null; // JSON string[] or null
  code_challenge: string | null;
  code_challenge_method: string | null;
  nonce: string | null;
  status: "pending" | "approved" | "denied";
  user_id: string | null;
  interval: number;
  last_polled_at: number;
  expires_at: number;
  created_at: number;
}

export interface OAuth2FAChallengeRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  action: string | null;
  nonce: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  consumed_at: number | null;
  expires_at: number;
  created_at: number;
  /** App-set: 1 means this specific challenge demands a captcha at /authorize
   *  even if the site default doesn't. */
  require_captcha: number;
}

export interface OAuth2FACodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  action: string | null;
  nonce: string | null;
  method: "totp" | "passkey" | "backup" | "sudo";
  code_challenge: string | null;
  code_challenge_method: string | null;
  used_at: number | null;
  expires_at: number;
  verified_at: number;
  created_at: number;
}

export interface OAuthTokenRow {
  id: string;
  access_token: string;
  refresh_token: string | null;
  /** The refresh token this row last rotated away, so presenting it again can
   *  be recognised as a replay. Stored in the same hashed form. */
  previous_refresh_token: string | null;
  client_id: string;
  user_id: string;
  scopes: string; // JSON string[]
  /** RFC 8707 resource indicators the grant was issued for, JSON string[] or
   *  null. Preserved so a refresh keeps the same audience. */
  resource: string | null;
  /** RFC 9449 DPoP: the JWK thumbprint this token is bound to, or null. */
  dpop_jkt: string | null;
  expires_at: number;
  refresh_expires_at: number | null;
  created_at: number;
}

export interface DomainRow {
  id: string;
  user_id: string;
  created_by: string | null;
  app_id: string | null;
  team_id: string | null;
  domain: string;
  verification_token: string;
  verified: number;
  verified_at: number | null;
  next_reverify_at: number | null;
  verification_method: string | null;
  created_at: number;
}

export interface SocialConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  profile_data: string; // JSON
  connected_at: number;
}

/** A notice-board entry. See worker/db/migrations/0060_notices.sql. */
export interface NoticeRow {
  id: string;
  title: string;
  /** Markdown, rendered client-side through the profile-README sanitizer. */
  body: string;
  level: "info" | "warning" | "critical";
  /** 'public' | 'users' | 'admins' | 'team' */
  audience: string;
  /** Set only when audience = 'team'. */
  team_id: string | null;
  is_published: number;
  /** NULL start = as soon as published; NULL end = until unpublished. */
  starts_at: number | null;
  ends_at: number | null;
  is_dismissible: number;
  pinned: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserEmailRow {
  id: string;
  user_id: string;
  email: string;
  verified: number;
  verify_token: string | null;
  verify_code: string | null;
  verified_via: string | null;
  verified_at: number | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: number;
  created_at: number;
}

export interface OAuthSourceRow {
  id: string;
  slug: string;
  provider: string;
  name: string;
  client_id: string;
  client_secret: string;
  enabled: number;
  created_at: number;
  // Nullable columns added in 0012 — only set for provider="oidc"|"oauth2"
  auth_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  scopes: string | null;
  // Added in 0013 — OIDC issuer URL for discovery reference
  issuer_url: string | null;
  // Added in 0046 — per-source icon override; null falls back to the
  // global default for the source's provider type.
  icon_url: string | null;
  // Added in 0046 — when 0, the source's login button renders text-only
  // (no icon, even if icon_url or a global default exists).
  show_icon: number;
  // Added in 0046 — tri-state login button display: 0 = text + icon
  // (default), 1 = icon only normal size, 2 = icon only large size.
  // Falls back to text when no icon is available.
  icon_only: number;
  // Added in 0050 — when 0, a login through this source is not fully
  // trusted: users with TOTP enrolled must additionally pass a TOTP
  // challenge before a session is issued. Existing rows default to 1
  // (trusted, fast path).
  trusted: number;
}

export interface SiteInviteRow {
  id: string;
  token: string;
  email: string | null;
  note: string | null;
  max_uses: number | null;
  use_count: number;
  created_by: string;
  expires_at: number | null;
  created_at: number;
}

export interface SiteConfigRow {
  key: string;
  value: string; // JSON-encoded
  updated_at: number;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: string; // JSON
  ip_address: string | null;
  created_at: number;
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string; // JSON string[]
  is_active: number;
  user_id: string | null; // null = admin-scope, non-null = user-scope
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface UserNotificationPrefsRow {
  user_id: string;
  events: string; // JSON Record<string, "brief"|"full"> — legacy: string[]
  tg_events: string; // JSON string[] — legacy Telegram event keys
  notification_rules: string; // JSON NotificationRules — current canonical format
}

export type {
  NotificationEmailRule,
  NotificationTgRule,
  NotificationDiscordRule,
  NotificationRule,
  NotificationRules,
} from "../shared/types";

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string; // JSON
  response_status: number | null;
  response_body: string | null;
  success: number;
  delivered_at: number;
}

export interface AppScopeDefinitionRow {
  id: string;
  app_id: string;
  scope: string;
  title: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface AppScopeAccessRuleRow {
  id: string;
  app_id: string;
  rule_type: "owner_allow" | "owner_deny" | "app_allow" | "app_deny";
  target_id: string;
  created_at: number;
}

export interface AppAccessRuleRow {
  id: string;
  app_id: string;
  rule_type: "team" | "user";
  target_id: string;
  min_role: "owner" | "co-owner" | "admin" | "member" | null;
  created_at: number;
}

export interface LoginErrorRow {
  id: string;
  error_code: string;
  identifier: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string; // JSON
  created_at: number;
}

// ─── Application types ────────────────────────────────────────────────────────

/** Anything that can defer work past the response.
 *
 *  Deliberately structural rather than the runtime's `ExecutionContext`: the
 *  two contexts in play are not interchangeable. @cloudflare/workers-types
 *  declares a required `tracing` field that Hono's runtime-agnostic stand-in
 *  (what `c.executionCtx` hands back) does not have, so a helper that names
 *  the global type cannot be called from a route handler. Helpers only ever
 *  fire-and-forget, so this is all they need to ask for. */
export type WaitUntilCtx = { waitUntil: (p: Promise<unknown>) => void };

export type SocialProvider = "github" | "google" | "microsoft" | "discord";

export type {
  CaptchaProvider,
  TurnstileEndpointMode,
  SiteConfig,
  RestrictedCapabilities,
  RestrictedCapability,
  TeamRolePermissions,
  TeamCapability,
} from "../shared/types";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "user";
  email_verified: boolean;
}

// Hono context variables
export type Variables = {
  user: AuthUser;
  sessionId: string;
  /** Set when a request is authenticated as an OAuth app using client credentials
   *  (HTTP Basic) rather than a user session. Only populated for endpoints that
   *  opt into app-self authentication. */
  appSelfAuth?: { appId: string; clientId: string };
  /** Set when a Personal Access Token authenticated the request instead of a
   *  session. A PAT carries only the scopes stamped on it, so privilege that
   *  rides on the *account* rather than the token — notably the site-admin
   *  override over every team — is deliberately withheld here: an
   *  `apps:write` token must not become a master key just because its owner
   *  happens to be an admin. */
  patAuth?: boolean;
  /** Per-team record of whether this request's authority over that team came
   *  from the site-admin override rather than membership. Populated by the
   *  team-authority helper and read when writing audit entries, so a team can
   *  tell an owner's action apart from the site acting over their heads. */
  teamElevation?: Map<string, boolean>;
};
