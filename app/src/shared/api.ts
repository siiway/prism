// Request and response shapes of the Prism API. The Worker builds them and
// the client reads them, so both import from here. The frontend re-exports
// everything through src/web/lib/api.

import type {
  CapMode,
  CaptchaProvider,
  RestrictedCapability,
  TeamRolePermissions,
} from "./types";
import type { NotificationRule as NotificationRulesetRule } from "./notificationRules";
import type { TeamPermission } from "./scopes";

export type { CapMode, CaptchaProvider };

/** Server-resolved directive telling the client which Turnstile challenge-script
 *  host to load. "server_region" has already been collapsed server-side into a
 *  concrete "global"/"china"; the client-side modes are resolved in the browser
 *  by the Captcha component. Absent on older servers → treated as "global". */
export type TurnstileEndpointDirective =
  "global" | "china" | "client_language" | "client_region";

/** Which of the two configured Turnstile widgets minted a token. Sent back
 *  with the token so the server verifies it against the matching secret — the
 *  global and China widgets have separate sitekey/secret pairs. */
export type TurnstileVariant = "global" | "china";

/** GeeTest v4 widget validate output, submitted for server-side verification. */
export interface GeetestOutput {
  lot_number: string;
  captcha_output: string;
  pass_token: string;
  gen_time: string;
}

/** Public captcha descriptor shared by every surface that renders a captcha
 *  (site config, team-join info, OAuth 2FA info). Mirrors the server's
 *  buildPublicCaptcha() output. Contains only public material — no secrets. */
export interface PublicCaptchaConfig {
  /** Ordered enabled set: element 0 is the default provider, the rest are
   *  switchable alternates. Empty means no captcha is required here. */
  captcha_providers: CaptchaProvider[];
  /** Seconds before the "try a different method" control is revealed. 0 = off. */
  captcha_switch_timeout_seconds: number;
  turnstile_site_key: string;
  turnstile_endpoint: TurnstileEndpointDirective;
  /** Sitekey of the region:"china" widget; empty unless the directive can
   *  actually route this visitor to the China host. */
  turnstile_china_site_key: string;
  hcaptcha_site_key: string;
  recaptcha_site_key: string;
  geetest_captcha_id: string;
  cap_mode: CapMode;
  cap_site_key: string;
  cap_api_endpoint: string;
}

export interface SitePublicConfig {
  site_name: string;
  site_description: string;
  site_icon_url: string | null;
  allow_registration: boolean;
  invite_only: boolean;
  captcha: PublicCaptchaConfig;
  require_email_verification: boolean;
  email_verify_methods: "link" | "send" | "both";
  accent_color: string;
  custom_css: string;
  /** Whether the operator has published a Privacy Policy. The content itself
   *  is fetched on demand via {@link api.legal}; this only gates the footer
   *  link and the /privacy route's empty state. */
  has_privacy_policy: boolean;
  /** Whether the operator has published Terms of Service. */
  has_terms_of_service: boolean;
  /** Whether the footer shows the "Powered by Prism" source link. */
  show_powered_by: boolean;
  initialized: boolean;
  r2_enabled: boolean;
  tg_notify_source_slug: string;
  discord_notify_source_slug: string;
  enable_public_profiles: boolean;
  default_profile_show_display_name: boolean;
  default_profile_show_avatar: boolean;
  default_profile_show_email: boolean;
  default_profile_show_joined_at: boolean;
  default_profile_show_gpg_keys: boolean;
  default_profile_show_authorized_apps: boolean;
  default_profile_show_owned_apps: boolean;
  default_profile_show_domains: boolean;
  default_profile_show_joined_teams: boolean;
  default_profile_show_readme: boolean;
  profile_readme_max_bytes: number;
  github_readme_has_site_token: boolean;
  github_readme_cache_ttl_seconds: number;
  default_team_profile_show_description: boolean;
  default_team_profile_show_avatar: boolean;
  default_team_profile_show_owner: boolean;
  default_team_profile_show_member_count: boolean;
  default_team_profile_show_apps: boolean;
  default_team_profile_show_domains: boolean;
  default_team_profile_show_members: boolean;
  /** Site default for whether public team profiles list their sub-teams. */
  default_team_profile_show_sub_teams: boolean;
  /** Site-wide floor for team join requirements. When true, every team
   *  effectively requires the factor regardless of the per-team flag. */
  default_team_require_2fa: boolean;
  default_team_require_verified_email: boolean;
  /** Ceiling on the usage limit a team may set on a registration-capable
   *  invite — the only hard bound on registration volume. */
  team_invite_registration_max_uses_cap: number;
  /** Registrations per hour per invite. Per-IP limiting cannot bound a link
   *  shared to thousands of people. */
  team_invite_registration_rate_per_hour: number;
  /** Features granted to invite-registered accounts. Absent keys fall back
   *  to the built-in defaults, which deny everything. */
  restricted_user_capabilities: Partial<Record<string, boolean>>;
  /** How long an unfinished registration survives before it is reaped. */
  restricted_pending_ttl_hours: number;
  /** Grace period between a dissolution deactivating accounts and the
   *  reaper deleting them. */
  restricted_dissolve_grace_hours: number;
  /** Master switch for the sub-team feature. When `false`, the UI hides
   *  the Sub-teams tab + dialog and the server rejects every sub-team
   *  endpoint. */
  enable_sub_teams: boolean;
  /** Operator-configured cap on team nesting depth (root = 0). */
  max_team_depth: number;
  /** When `false`, ancestor membership stops cascading to descendants. */
  inherit_team_membership: boolean;
  /** When `false`, ancestor-owned domains stop appearing in sub-team
   *  domain listings. */
  inherit_team_domains: boolean;
  enabled_providers: {
    slug: string;
    name: string;
    provider: string;
    icon_url?: string | null;
    show_icon?: number;
    /** Pre-proxied URL ready to drop into <img src> without calling the
     *  client-side proxy register (which requires auth). Null when the
     *  source has no resolvable icon (e.g. show_icon=0, or an unknown
     *  provider type with no override). */
    icon_proxied_url?: string | null;
    /** True when the resolved icon is a known monochrome black silhouette
     *  (built-in default for x, github, etc.) — the UI should apply an
     *  invert filter in dark mode so it doesn't vanish on dark
     *  backgrounds. False for per-source override icons (palette
     *  unknown). */
    icon_invert_on_dark?: boolean;
    /** Tri-state, gated on actually having an icon to render:
     *    0 = text + icon (default)
     *    1 = icon-only, normal size
     *    2 = icon-only, large size
     *  Server forces 0 when no icon is available, so the frontend can
     *  trust this without re-checking. The provider name still flows in
     *  via aria-label for icon-only modes. */
    icon_only?: 0 | 1 | 2;
  }[];
}

/** The two operator-authored legal documents, addressed by slug. */
export type LegalDocType = "privacy" | "terms";

export interface LegalDoc {
  doc: LegalDocType;
  /** Raw markdown. Empty string when the operator hasn't published it. */
  content: string;
  /** Unix seconds of the last edit, or null when unpublished. */
  updated_at: number | null;
}

/** One legal document as returned to the admin editor. */
export interface AdminLegalDocument {
  slug: LegalDocType;
  content: string;
  updated_at: number | null;
}

export interface RegisterBody {
  email: string;
  username: string;
  password: string;
  display_name?: string;
  invite_token?: string;
  provider?: CaptchaProvider;
  captcha_token?: string;
  captcha_variant?: TurnstileVariant;
  geetest?: GeetestOutput;
  cap_token?: string;
}

export interface LoginBody {
  identifier: string;
  password: string;
  totp_code?: string;
  provider?: CaptchaProvider;
  captcha_token?: string;
  captcha_variant?: TurnstileVariant;
  geetest?: GeetestOutput;
  cap_token?: string;
}

export type SessionUser = Pick<
  UserProfile,
  | "id"
  | "email"
  | "username"
  | "display_name"
  | "avatar_url"
  | "unproxied_avatar_url"
  | "role"
  | "email_verified"
>;

export interface AuthResponse {
  user: SessionUser;
}

export interface LoginResponse extends Partial<AuthResponse> {
  totp_required?: boolean;
  error?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  unproxied_avatar_url: string | null;
  role: "admin" | "user";
  email_verified: boolean;
  alt_email_login: number | null;
  access_token_ttl_minutes: number | null;
  refresh_token_ttl_days: number | null;
  notify_on_auto_authorization: boolean;
  /** true (default) = gpg-login still asks for a TOTP code when the account
   *  has an enrolled authenticator; false = trust the GPG signature alone.
   *  See Security > GPG keys > "Require 2FA after GPG verification". */
  gpg_require_2fa: boolean;
  profile_is_public: boolean;
  /** Per-field overrides — null means "follow the site default". */
  profile_show_display_name: boolean | null;
  profile_show_avatar: boolean | null;
  profile_show_email: boolean | null;
  profile_show_joined_at: boolean | null;
  profile_show_gpg_keys: boolean | null;
  profile_show_authorized_apps: boolean | null;
  profile_show_owned_apps: boolean | null;
  profile_show_domains: boolean | null;
  profile_show_joined_teams: boolean | null;
  profile_show_readme: boolean | null;
  /** Raw markdown source for the profile README. Ignored when source =
   *  'github' — the displayed content comes from the GitHub cache. */
  profile_readme: string | null;
  profile_readme_updated_at: number | null;
  profile_readme_source: "manual" | "github";
  profile_readme_source_meta: {
    connection_id: string | null;
    github_login: string;
  } | null;
  profile_readme_synced_at: number | null;
  /** True when a per-user GitHub PAT is stored. The token itself is never
   *  sent back to the client — set/clear via PATCH only. */
  github_readme_token_set: boolean;
  created_at?: number;
}

export interface PublicUserProfile {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  unproxied_avatar_url: string | null;
  email: string | null;
  joined_at: number | null;
  gpg_keys: Array<{
    fingerprint: string;
    key_id: string;
    name: string;
    created_at: number;
  }> | null;
  authorized_apps: Array<{
    client_id: string;
    name: string;
    icon_url: string | null;
    website_url: string | null;
    granted_at: number;
  }> | null;
  owned_apps: Array<{
    id: string;
    client_id: string;
    name: string;
    description: string;
    icon_url: string | null;
    website_url: string | null;
    created_at: number;
  }> | null;
  domains: Array<{
    domain: string;
    verified_at: number | null;
  }> | null;
  joined_teams: Array<{
    id: string;
    name: string;
    avatar_url: string | null;
    role: "owner" | "co-owner" | "admin" | "member";
  }> | null;
  /** Raw markdown — sanitize and rewrite images through the proxy before
   *  rendering. Null when the user has no readme or it's hidden. */
  readme: string | null;
  readme_updated_at: number | null;
  readme_source: "manual" | "github" | null;
}

export interface MeResponse {
  user: UserProfile;
  totp_enabled: boolean;
  passkey_count: number;
  site_access_token_ttl_minutes: number;
  site_refresh_token_ttl_days: number;
}

export interface PasskeyInfo {
  id: string;
  name: string | null;
  device_type: string;
  backed_up: number;
  created_at: number;
  last_used_at: number | null;
}

export interface GpgKeyInfo {
  id: string;
  fingerprint: string;
  key_id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface SessionInfo {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: number;
  expires_at: number;
  is_current: boolean;
  // Full Cloudflare geolocation (JSON string, src/worker/lib/geo.ts GeoInfo) for
  // the IP the session was created from. Null on non-Cloudflare paths (e.g.
  // local dev) or until the first authenticated request has recorded it.
  ip_geo: string | null;
}

// One distinct IP a session has authenticated from, with the full Cloudflare
// geolocation snapshot (JSON string) and when it was first/last seen.
export interface SessionIpInfo {
  ip_address: string;
  geo: string | null;
  first_seen: number;
  last_seen: number;
}

export interface OAuthToken {
  id: string;
  scopes: string[];
  created_at: number;
  expires_at: number;
  /** When the sign-in ends: the refresh token's expiry for remembered ones. */
  ends_at: number;
  is_persistent: boolean;
}

export interface OAuthConsent {
  client_id: string;
  scopes: string[];
  granted_at: number;
  auto_authorize: boolean;
  app: {
    name: string;
    description: string;
    icon_url: string | null;
    website_url: string | null;
    is_verified: boolean;
  };
  tokens: OAuthToken[];
}

/** What the standalone /join/<teamId> page needs to render itself. */
export interface JoinPageInfo {
  team: {
    id: string;
    name: string;
    description: string;
    avatar_url: string | null;
  };
  requirements: JoinRequirements;
  /** False when the team's invite path skips email collection entirely — the
   *  account gets a synthesised placeholder it can replace later. */
  collects_email: boolean;
  captcha: PublicCaptchaConfig;
  /** Always true: the page must state that dissolving the team deletes the
   *  accounts it created, before anyone signs up. */
  deletion_notice: boolean;
}

export interface JoinRequirements {
  require_2fa: boolean;
  require_verified_email: boolean;
  forced_by_site: { require_2fa: boolean; require_verified_email: boolean };
}

// RestrictedCapability — see src/shared/types.ts.

/** Whether the signed-in account is operating under invite-registration
 *  restrictions, and what it would take to lift them. */
export interface RestrictionInfo {
  restricted: boolean;
  converted_at?: number | null;
  pending_join?: boolean;
  origin_team?: { id: string; name: string } | null;
  capabilities?: Record<RestrictedCapability, boolean>;
  conversion?: {
    available: boolean;
    needs_real_email: boolean;
    synthetic_email: boolean;
  };
}

export interface Team {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  unproxied_avatar_url: string | null;
  role: string; // current user's role
  my_role?: string;
  /** Immediate parent team id when this team is a sub-team, `null` for
   *  top-level teams. */
  parent_team_id?: string | null;
  /** When this listing entry surfaced via inheritance from an ancestor
   *  team, carries that ancestor's id. `null` for direct memberships. */
  inherited_from?: string | null;
  /** Set on the team detail response when `my_role` came from the site-admin
   *  override rather than a membership — the page says so rather than
   *  passing the viewer off as an owner. */
  site_admin_access?: boolean;
  /** Set on the team detail response — the role the viewer would hold with the
   *  site-admin override dropped ("normal view"). `null` when they aren't a
   *  member, so the banner knows a switch to normal view leads nowhere. */
  my_member_role?: "owner" | "co-owner" | "admin" | "member" | null;
  /** Set on the team detail response — chain of ancestor teams, immediate
   *  parent first → root last. */
  ancestors?: TeamAncestor[];
  /** Set on the team detail response — immediate sub-teams + member count. */
  sub_teams?: SubTeamSummary[];
  /** Set on the team detail response — total direct sub-team count across all
   *  pages (the embedded `sub_teams` list is first-page only). */
  sub_team_count?: number;
  profile_is_public: boolean;
  /** Per-section overrides — null means "follow the site default". */
  profile_show_description: boolean | null;
  profile_show_avatar: boolean | null;
  profile_show_owner: boolean | null;
  profile_show_member_count: boolean | null;
  profile_show_apps: boolean | null;
  profile_show_domains: boolean | null;
  profile_show_members: boolean | null;
  /** Per-team override for whether the public profile lists sub-teams.
   *  `null` follows the site default
   *  (default_team_profile_show_sub_teams). */
  profile_show_sub_teams: boolean | null;
  /** Per-team override of the user's profile_show_joined_teams toggle —
   *  surfaced from the user's own membership row (`team_members` join). */
  show_on_profile?: boolean | null;
  /** Owner-set join requirements — also re-checked when a member tries
   *  to remove their last 2FA factor or unverify their email. */
  require_2fa: boolean;
  require_verified_email: boolean;
  /** Site-admin grant: may this team mint accounts through invite links?
   *  The only switch for it (closed sign-up also stops it). Read-only to
   *  the team; only an instance admin can change it. */
  invite_registration_granted: boolean;
  /** May accounts this team's invites created convert themselves to full
   *  accounts? A site admin's override; null = the site default. */
  invite_registration_allow_convert: boolean | null;
  /** Site-level registration checks this team's invite path may skip.
   *  Set by a site admin; captcha, proof-of-work and rate limits are never
   *  exemptible and never appear here. */
  invite_registration_exemptions: { email_verification?: boolean };
  /** Whether unrestricted accounts may join through an invite link. */
  allow_normal_user_join: boolean;
  /** Whether member list visibility is restricted for regular members. */
  restrict_member_list_for_members: boolean;
  /** Set while a staged dissolution is in flight. */
  dissolving_at: number | null;
  /** Owner-only opt-in for member groups. Off by default; while off no read
   *  surface emits groups, but the definitions and assignments are kept. */
  enable_groups: boolean;
  /** Owner-configured capability overrides for the `admin` role. Absent keys
   *  fall through to the site default and then the built-in default. */
  role_permissions: TeamRolePermissions;
  created_at: number;
  updated_at: number;
}

// TeamCapability / TeamRolePermissions — see src/shared/types.ts.

/** A group definition as managed on the team. */
export interface TeamGroup {
  id: string;
  /** Stable identifier downstream apps authorize on. Immutable. */
  slug: string;
  name: string;
  description: string;
  color: string | null;
  /** Per-group override of the admin `groups:assign` capability.
   *  `null` follows the team/site/built-in chain. Owner-only to change. */
  admin_assignable: boolean | null;
  /** Whether the current viewer may assign or remove this group. */
  can_assign: boolean;
  created_at: number;
  updated_at: number;
}

/** A group as it appears on a member, after enable/inheritance resolution. */
export interface MemberGroup {
  slug: string;
  name: string;
  color: string | null;
  /** Ancestor team id when inherited from a parent team, `null` when
   *  assigned on the team being viewed. Inherited labels are managed at the
   *  ancestor they come from. */
  inherited_from: string | null;
}

/** Compact ancestor reference on the team detail response. */
export interface TeamAncestor {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** Immediate sub-team summary on the team detail response. */
export interface SubTeamSummary {
  id: string;
  name: string;
  avatar_url: string | null;
  member_count: number;
}

/** Item returned by `GET /api/teams/:id/sub-teams`. Carries the caller's
 *  effective role + the ancestor team that grants it. */
export interface SubTeamListItem {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  unproxied_avatar_url: string | null;
  parent_team_id: string | null;
  member_count: number;
  my_role: "owner" | "co-owner" | "admin" | "member";
  inherited_from: string;
  created_at: number;
}

export interface PublicTeamProfile {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  unproxied_avatar_url: string | null;
  created_at: number;
  owner: {
    username: string | null;
    display_name: string;
    avatar_url: string | null;
  } | null;
  member_count: number | null;
  apps: Array<{
    id: string;
    client_id: string;
    name: string;
    description: string;
    icon_url: string | null;
    website_url: string | null;
    created_at: number;
  }> | null;
  domains: Array<{
    domain: string;
    verified_at: number | null;
  }> | null;
  members: Array<{
    username: string;
    display_name: string;
    avatar_url: string | null;
    role: "owner" | "co-owner" | "admin" | "member";
  }> | null;
  /** Immediate sub-teams that themselves have a public profile. `null` if
   *  the sub-team section is hidden or the feature is off site-wide. */
  sub_teams: Array<{
    id: string;
    name: string;
    avatar_url: string | null;
    member_count: number;
  }> | null;
  /** Parent team breadcrumb — only set when the parent is itself public. */
  parent_team: { id: string; name: string; avatar_url: string | null } | null;
}

export interface TeamMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: "owner" | "co-owner" | "admin" | "member";
  joined_at: number;
  /** Resolved member groups — empty when the team has groups disabled. */
  groups?: MemberGroup[];
}

export interface TeamInvite {
  token: string | null;
  team_id: string;
  role: string;
  email: string | null;
  max_uses: number;
  uses: number;
  expires_at: number;
  created_at: number;
  created_by: string;
  created_by_username: string;
  allows_registration: boolean;
  groups: InviteMemberGroup[];
  allow_existing_members: boolean;
  enabled: boolean;
  can_manage: boolean;
}

export interface InviteMemberGroup {
  id: string;
  slug: string;
  name: string;
  color: string | null;
}

export interface TeamInviteInfo {
  team: {
    id: string;
    name: string;
    description: string;
    avatar_url: string | null;
    unproxied_avatar_url: string | null;
  };
  role: string;
  email: string | null;
  groups: InviteMemberGroup[];
  allow_existing_members: boolean;
  can_apply_groups: boolean;
  expires_at: number;
  user: { id: string; username: string } | null;
  already_member: boolean;
  requirements: {
    require_2fa: boolean;
    require_verified_email: boolean;
    /** Subset forced by the site floor — present so the UI can show
     *  which requirements a team owner could not have disabled. */
    forced_by_site: {
      require_2fa: boolean;
      require_verified_email: boolean;
    };
  };
  /** Subset of the team's requirements the current session user does not
   *  satisfy. Empty array (or any when unauthenticated) = nothing blocking. */
  unmet_requirements: Array<"verified_email" | "2fa">;
}

export interface AdminTeam {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  member_count: number;
  app_count: number;
  owner_username: string | null;
  /** Site-admin grant allowing this team to mint accounts through invite
   *  links. The admin list surfaces it so the grant can be toggled inline. */
  invite_registration_granted: number;
  /** 1 / 0 = a site admin's override for converting to a full account;
   *  null = the site default. */
  invite_registration_allow_convert: number | null;
  /** Site-level registration checks this team's invite path may skip.
   *  Only email verification is exemptible. */
  invite_registration_exemptions: { email_verification?: boolean };
  /** Non-null while a staged dissolution is in flight. */
  dissolving_at: number | null;
  created_at: number;
  updated_at: number;
}

// ─── Per-account admin control ────────────────────────────────────────────────

export interface AdminUserSecurity {
  has_password: boolean;
  totp_authenticators: Array<{
    id: string;
    name: string;
    enabled: boolean;
    created_at: number;
  }>;
  passkeys: Array<{
    id: string;
    name: string | null;
    device_type: string;
    backed_up: boolean;
    created_at: number;
    last_used_at: number | null;
  }>;
  /** `count` is -1 when the stored blob could not be parsed. */
  recovery_codes: { count: number; updated_at: number | null };
}

export interface AdminUserToken {
  id: string;
  name: string;
  scopes: string[];
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
}

export interface AdminUserConnection {
  id: string;
  provider: string;
  provider_user_id: string;
  token_expires_at: number | null;
  connected_at: number;
}

export interface AdminUserGpgKey {
  id: string;
  fingerprint: string;
  key_id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface AdminUserEmails {
  primary: { email: string; verified: boolean; verified_at: number | null };
  emails: Array<{
    id: string;
    email: string;
    verified: boolean;
    verified_via: string | null;
    verified_at: number | null;
    created_at: number;
  }>;
}

export interface AdminUserDomain {
  id: string;
  domain: string;
  verified: boolean;
  created_at: number;
}

export interface AdminUserAuthorization {
  id: string;
  client_id: string;
  scopes: string[];
  granted_at: number;
  app_name: string | null;
  icon_url: string;
}

export interface AdminUserTeam {
  id: string;
  name: string;
  avatar_url: string;
  role: string;
  joined_at: number;
}

// ─── Direct database access ───────────────────────────────────────────────────

export interface DbColumn {
  name: string;
  type: string;
  notnull: boolean;
  default_value: string | null;
  pk: boolean;
}

export interface DbTable {
  name: string;
  /** null when the count query failed (a view-like or corrupt table). */
  row_count: number | null;
  /** The CREATE TABLE statement, straight from sqlite_master. */
  sql: string | null;
  columns: DbColumn[];
}

export interface DbRowPage {
  table: string;
  columns: DbColumn[];
  /** Columns that address a single row — the declared PK, or ["rowid"]. */
  key_columns: string[];
  /** False when no row can be addressed individually; edits go through SQL. */
  editable: boolean;
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}

export interface DbQueryResult {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** True when the result set was cut off at the server's row cap. */
  truncated: boolean;
  row_count: number;
  rows_written: number;
  last_row_id: number | null;
  duration_ms: number | null;
}

// ─── Key-value browser ────────────────────────────────────────────────────────

export interface KvKeyPage {
  keys: Array<{
    name: string;
    expiration: number | null;
    metadata: unknown;
    /** Key material — its value is withheld and it cannot be written here. */
    protected: boolean;
  }>;
  list_complete: boolean;
  /** Opaque continuation token; null when the listing is complete. */
  cursor: string | null;
}

export interface KvEntry {
  key: string;
  protected: boolean;
  exists: boolean;
  /** Always null for a protected key. */
  value: string | null;
  metadata: unknown;
}

export interface AdminDomain {
  id: string;
  domain: string;
  verified: boolean;
  verified_at: number | null;
  user_id: string | null;
  team_id: string | null;
  owner_username: string | null;
  team_name: string | null;
  team_avatar: string;
  created_at: number;
}

export type ScopeGrantKind = "site" | "team";

/** A site- or team-level scope grant still held by an app: one per app and
 *  account (site) or app and team (team), from the latest approval. */
export interface AdminScopeGrant {
  id: string;
  client_id: string;
  app_name: string | null;
  granted_at: number;
  /** site grants: the site:* scopes approved */
  scopes?: string[];
  grantee_user_id?: string | null;
  grantee_username?: string | null;
  /** team grants: the team permissions approved, e.g. "member:read" */
  permissions?: string[];
  team_id?: string;
  team_name?: string | null;
  grantor_user_id?: string | null;
  grantor_username?: string | null;
}

export interface AdminScopeGrantDetail extends AdminScopeGrant {
  kind: ScopeGrantKind;
  first_granted_at: number;
  times_granted: number;
  /** What the latest approval listed. */
  listed: string[];
  /** What the app holds now, across approvals and live tokens. Team
   *  permissions come without the team:<id>: prefix. */
  held_scopes: string[];
  live_tokens: number;
  accounts: number;
  /** team grants: the grantor's current role, which caps the app's. */
  grantor_role?: string | null;
}

// ─── Notice board ─────────────────────────────────────────────────────────────

export const NOTICE_LEVELS = ["info", "warning", "critical"] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];
/** `public` also reaches the signed-out pages; `team` needs a team_id. */
export const NOTICE_AUDIENCES = ["public", "users", "admins", "team"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export interface Notice {
  id: string;
  title: string;
  /** Markdown — render through lib/markdown, never as raw HTML. */
  body: string;
  level: NoticeLevel;
  audience: NoticeAudience;
  team_id: string | null;
  team_name?: string | null;
  is_dismissible: boolean;
  pinned: boolean;
  starts_at: number | null;
  ends_at: number | null;
  created_at: number;
}

export interface AdminNotice extends Notice {
  is_published: boolean;
  created_by: string | null;
  created_by_username?: string | null;
  dismissal_count?: number;
  updated_at: number;
}

export interface NoticeInput {
  title: string;
  body: string;
  level?: NoticeLevel;
  audience?: NoticeAudience;
  team_id?: string | null;
  is_published?: boolean;
  starts_at?: number | null;
  ends_at?: number | null;
  is_dismissible?: boolean;
  pinned?: boolean;
}

export interface AdminTeamInvite {
  /** The credential itself — shown so a leaked link can be matched to a row. */
  token: string;
  team_id: string;
  team_name: string | null;
  role: string;
  email: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_at: number;
  created_by_username: string | null;
  /** True when this invite mints accounts rather than adding existing ones. */
  allows_registration: boolean;
  groups: InviteMemberGroup[];
  enabled: boolean;
}

export interface AdminSession {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: number;
  expires_at: number;
  /** Where this session has been used from, most recent first. */
  ips: Array<{
    ip_address: string | null;
    geo: unknown;
    first_seen: number;
    last_seen: number;
  }>;
}

export const REDIRECT_URI_MATCH_TYPES = [
  "equals",
  "regex",
  "wildcard",
] as const;
export type RedirectUriMatchType = (typeof REDIRECT_URI_MATCH_TYPES)[number];

export interface RedirectUri {
  type: RedirectUriMatchType;
  value: string;
}

export interface OAuthApp {
  id: string;
  name: string;
  description: string;
  icon_url: string | null;
  unproxied_icon_url: string | null;
  website_url: string | null;
  client_id: string;
  /** Whether a write-only client secret is configured. */
  has_client_secret: boolean;
  redirect_uris: RedirectUri[];
  allowed_scopes: string[];
  optional_scopes: string[];
  is_public: boolean;
  is_active: boolean;
  is_verified: boolean;
  is_official: boolean;
  is_first_party: boolean;
  use_jwt_tokens: boolean;
  allow_self_manage_exported_permissions: boolean;
  access_whitelist_enabled: boolean;
  post_logout_redirect_uris: string[];
  backchannel_logout_uri: string | null;
  /** RFC 7591 token_endpoint_auth_method, or null to infer from is_public. */
  token_endpoint_auth_method: string | null;
  /** RFC 7523 private_key_jwt: inline JWK Set (JSON string) and/or a JWKS URI. */
  jwks: string | null;
  jwks_uri: string | null;
  team_id: string | null;
  created_at: number;
  updated_at: number;
  owner_username?: string | null;
  team_name?: string | null;
  team_avatar_url?: string | null;
}

/** App representation returned only by a create operation. */
export interface CreatedOAuthApp extends OAuthApp {
  /** Fresh plaintext credential; save it now because reads never return it. */
  client_secret: string;
}

export interface CreateAppBody {
  name: string;
  description?: string;
  icon_url?: string;
  website_url?: string;
  redirect_uris: RedirectUri[];
  allowed_scopes?: string[];
  optional_scopes?: string[];
  is_public?: boolean;
  use_jwt_tokens?: boolean;
  allow_self_manage_exported_permissions?: boolean;
  access_whitelist_enabled?: boolean;
  /** OIDC RP-Initiated Logout: exact-match allow-list of post-logout redirect URIs. */
  post_logout_redirect_uris?: string[];
  /** OIDC Back-Channel Logout notification endpoint (https), or null to clear. */
  backchannel_logout_uri?: string | null;
  /** RFC 7591 token_endpoint_auth_method (none | client_secret_basic |
   *  client_secret_post | private_key_jwt), or null/"" to infer from is_public. */
  token_endpoint_auth_method?: string | null;
  /** RFC 7523 private_key_jwt: inline JWK Set as a JSON string, or null to clear. */
  jwks?: string | null;
  /** RFC 7523 private_key_jwt: an https URL serving the client's JWK Set, or null. */
  jwks_uri?: string | null;
}

// ─── Audit logs (Transparent Control) ────────────────────────────────────────

/** One match from GET /api/search. */
export type SearchKind =
  "app" | "team" | "domain" | "token" | "consent" | "user" | "oauth_source";

export interface SearchHit {
  kind: SearchKind;
  /** Site-wide (admin) result rather than one of the user's own. */
  admin: boolean;
  id: string;
  title: string;
  subtitle: string | null;
  /** In-app path to open it. */
  url: string;
}

export interface AuditEvent {
  id: string;
  scope: "user" | "team" | "platform";
  scope_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  ip: string | null;
  user_agent: string | null;
  // JSON snapshot of the request's Cloudflare geolocation (src/worker/lib/geo.ts).
  ip_geo: string | null;
  metadata: string;
  created_at: number;
}

export interface AuditEventsResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  actions: string[];
}

export interface AuditQuery {
  from?: number;
  to?: number;
  action?: string;
  actor_id?: string;
  resource_type?: string;
  resource_id?: string;
  page?: number;
}

export type AuditWebhookKind = "discord" | "telegram" | "general";

export interface AuditWebhookDelivery {
  at: number;
  success: boolean;
  status: number | null;
  body: string;
}

export interface AuditWebhook {
  id: string;
  name: string;
  kind: AuditWebhookKind;
  config: Record<string, unknown>;
  events: string[];
  is_active: boolean;
  created_at: number;
  updated_at: number;
  last_delivery?: AuditWebhookDelivery | null;
}

export interface AuditWebhookInput {
  name?: string;
  kind?: AuditWebhookKind;
  config?: Record<string, unknown>;
  events?: string[];
  is_active?: boolean;
}

export const VERIFICATION_METHODS = [
  "dns-txt",
  "http-file",
  "html-meta",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export interface Domain {
  id: string;
  domain: string;
  verification_token: string;
  verified: number;
  verified_at: number | null;
  next_reverify_at: number | null;
  verification_method: VerificationMethod | null;
  created_at: number;
  /** Who added it. A team domain moved out of the team goes back to them. */
  user_id?: string;
}

export interface DomainAddResponse {
  id: string;
  domain: string;
  verification_token: string;
  txt_record: string;
  txt_value: string;
  http_path: string;
  http_url: string;
  http_value: string;
  meta_tag: string;
  verified: boolean;
}

export interface DomainVerifyResponse {
  verified: boolean;
  next_reverify_at?: number;
  verification_method?: VerificationMethod;
  verified_by_parent?: string;
  attempted_method?: VerificationMethod | null;
  instructions?: {
    txt_record: string;
    txt_value: string;
    http_path: string;
    http_url: string;
    http_value: string;
    meta_tag: string;
  };
}

export interface SocialPendingInfo {
  type: "register" | "select";
  provider: string;
  /** The source's display name. */
  provider_name: string;
  profile_name: string | null;
  profile_avatar: string | null;
  suggested_username?: string;
  suggested_display_name?: string;
  users?: Array<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  }>;
}

export interface Social2faPendingInfo {
  provider_name: string;
  user: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface SocialConnection {
  id: string;
  provider: string;
  provider_user_id: string;
  profile: unknown;
  connected_at: number;
}

export interface OAuthAuthorizeInfo {
  app: {
    id: string;
    name: string;
    description: string;
    icon_url: string | null;
    website_url: string | null;
    is_verified: boolean;
    is_official: boolean;
    is_first_party: boolean;
    is_public: boolean;
  };
  scopes: string[];
  optional_scopes: string[];
  app_scopes: Array<{
    scope: string;
    client_id: string;
    inner_scope: string;
    app_name: string;
    app_icon_url: string | null;
    scope_title: string | null;
    scope_desc: string | null;
  }>;
  /** Scopes the client requested in the authorize URL but that were filtered
   *  out — surfaced so the user can see what was asked for vs what's actually
   *  being granted. `reason` distinguishes "not in the app's allowed_scopes"
   *  from "unknown scope" / "denied by target app" / "target app missing". */
  rejected_scopes: Array<{
    scope: string;
    reason: "not_allowed" | "unknown" | "app_denied" | "target_missing";
  }>;
  redirect_uri: string;
  state: string | null;
  /** OIDC prompt / max_age evaluation (see the /app-info handler). */
  prompt: string | null;
  max_age: number | null;
  reauth_required: boolean;
  prompt_none_error: string | null;
  prior_consent_covers: boolean;
  auto_authorize_eligible: boolean;
  user: UserProfile | null;
  requires_site_grant: boolean;
  site_scope_confirm_phrase: string | null;
  site_scopes_grantable: boolean;
  requires_team_grant: boolean;
  team_grant_permissions: TeamPermission[];
  user_admin_teams: Array<{
    id: string;
    name: string;
    avatar_url: string | null;
    role: string;
  }>;
  /** Scopes the user previously granted to this app, or null if no prior
   *  consent. Used to gate the "Log back in" affordance: when these match
   *  the currently-selected scopes exactly, the user can replace existing
   *  tokens with a single fresh one. */
  existing_consent_scopes: string[] | null;
  /** Count of still-valid tokens this user has for this app. */
  existing_token_count: number;
}

export interface OAuth2FAInfo {
  app: {
    id: string;
    name: string;
    description: string;
    icon_url: string | null;
    unproxied_icon_url: string | null;
    website_url: string | null;
    is_verified: boolean;
    is_official: boolean;
    is_first_party: boolean;
    is_public: boolean;
  };
  challenge_id: string;
  redirect_uri: string;
  state: string | null;
  action: string | null;
  expires_at: number;
  user: UserProfile | null;
  totp_enrolled: boolean;
  passkey_enrolled: boolean;
  backup_codes_available: boolean;
  has_any_2fa: boolean;
  /** True if this user already has a sudo grace window open for this app on
   *  this session — the page can offer a one-click confirm without TOTP. */
  sudo_active: boolean;
  /** Site-wide sudo TTL in minutes. 0 = sudo mode disabled. */
  sudo_ttl_minutes: number;
  /** True if this challenge requires a captcha solve (site default OR app
   *  opt-in AND a provider is configured AND sudo bypass is not active). */
  captcha_required: boolean;
  /** Captcha descriptor. `captcha_providers` is empty when no captcha is
   *  required for this challenge. */
  captcha: PublicCaptchaConfig;
}

export interface OAuth2FAAuthorizeBody {
  challenge_id: string;
  state?: string;
  decision: "approve" | "deny";
  totp_code?: string;
  passkey_verify_token?: string;
  /** Open a sudo grace window for this (session, client) on success. Ignored
   *  when used together with `use_sudo`. */
  enable_sudo?: boolean;
  /** Bypass TOTP/passkey using an already-active sudo grant. Server rejects
   *  if no grant is active or sudo mode is disabled. */
  use_sudo?: boolean;
  /** Which captcha provider produced the proof below. The server verifies
   *  against this provider and rejects one not in the enabled set. */
  provider?: CaptchaProvider;
  /** Captcha verification token. Required when info.captcha_required is true
   *  and provider is turnstile/hcaptcha/recaptcha. */
  captcha_token?: string;
  captcha_variant?: TurnstileVariant;
  /** GeeTest v4 validate output. Required when provider is "geetest". */
  geetest?: GeetestOutput;
  /** Cap redeem token. Required when provider is "cap". */
  cap_token?: string;
}

export interface OAuthApproveBody {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  nonce?: string;
  action: "approve" | "deny";
  authorization_mode?: "once" | "always";
  totp_code?: string;
  passkey_verify_token?: string;
  confirm_text?: string;
  team_id?: string;
  /** When true and the granted scopes match a prior consent exactly, the
   *  server revokes existing tokens for this app before issuing the new
   *  authorization code — a "log back in" rather than a parallel session. */
  revoke_existing_tokens?: boolean;
  /** RFC 9126: when the request was pushed, its request_uri. The server reads
   *  the security-critical parameters from the pushed request, not the body. */
  request_uri?: string;
  /** RFC 8707 resource indicator(s) for a non-pushed request. */
  resource?: string | string[];
  /** OIDC prompt / max_age forwarded so the server can enforce max_age. */
  prompt?: string;
  max_age?: number;
}

export interface DeviceVerifyInfo {
  app: OAuthAuthorizeInfo["app"];
  scopes: string[];
  user: OAuthAuthorizeInfo["user"];
  user_code: string;
}

export type SamlNameIdFormat = "persistent" | "email";
export type SamlSignMode = "assertion" | "response" | "both";
export type SamlSloBinding = "redirect" | "post";
/** Why an app can't use SAML: a site admin turned it off for the site, the
 *  app's owner or the app. */
export type SamlBlock =
  "saml_disabled" | "saml_disabled_user" | "saml_disabled_app";

/** An app's SAML service-provider settings. */
export interface SamlServiceProvider {
  entity_id: string;
  acs_urls: string[];
  name_id_format: SamlNameIdFormat;
  sign: SamlSignMode;
  /** SingleLogoutService URL; null when the SP has no single logout. */
  slo_url: string | null;
  slo_binding: SamlSloBinding;
  /** The SP's signing certificate (PEM), to verify its logout messages;
   *  null when none is on file. */
  signing_cert: string | null;
  updated_at: number;
}

/** GET /apps/:id/saml */
export interface AppSamlInfo {
  /** null while SAML is off for the app. */
  saml: SamlServiceProvider | null;
  /** Set when a site admin turned SAML off for the app, its owner or the
   *  site: sign-in doesn't work and the settings can't be saved. */
  disabled: SamlBlock | null;
  /** What to give the service provider. */
  idp: {
    entity_id: string;
    metadata_url: string;
    sso_url: string;
    slo_url: string;
    /** PEM. */
    certificate: string;
  };
  /** The app's allowed scopes whose attributes SAML carries. */
  released_scopes: string[];
}

/** GET/PATCH /admin/{users,apps}/:id/saml — a site admin's override. */
export interface AdminSamlSetting {
  /** null follows the level above. */
  override: boolean | null;
  /** What following the level above currently means. */
  inherited: boolean;
}

export type SamlUpdateBody = Omit<SamlServiceProvider, "updated_at">;

/** POST /saml/logout — the next step of a browser sign-out: ask
 *  the user (another site asked for it), a URL to go to (HTTP-Redirect, or
 *  the end) or a form to post (HTTP-POST). */
export type SamlLogoutStep =
  | {
      kind: "confirm";
      /** The app that asked, when known. */
      app: { name: string; icon_url: string | null } | null;
    }
  | { kind: "redirect"; url: string }
  | { kind: "post"; url: string; fields: Record<string, string> };

/** GET /saml/requests/:token — what the sign-in page does next. */
export interface SamlRequestInfo {
  app: OAuthAuthorizeInfo["app"];
  /** "profile": only the SAML profile is asked for; consent is settled. */
  next: "login" | "reauth" | "consent" | "profile" | "continue" | "decline";
  /** An API error code: why this account can't sign in to the app. */
  error: string | null;
  scopes: string[];
  name_id_format: SamlNameIdFormat;
  user: OAuthAuthorizeInfo["user"] | null;
  /** The SAML profile the app gets for the user, once chosen. */
  profile: SamlProfileSummary | null;
  /** Before one is chosen: the user's shared profiles to pick from. Empty
   *  means the app gets a new per-app profile without asking. */
  profile_choices: SamlProfileSummary[];
}

/** "app": made for one app at the first sign-in to it. "shared": made by
 *  the user, and usable for any number of apps. */
export type SamlProfileKind = "app" | "shared";

export interface SamlProfileSummary {
  id: string;
  kind: SamlProfileKind;
  /** A shared profile's name; null for a per-app one. */
  name: string | null;
  /** The ID apps receive (persistent NameID and uid). */
  name_id: string;
}

/** One of the user's SAML profiles, with the apps that get it. */
export interface SamlProfile extends SamlProfileSummary {
  apps: { id: string; name: string; icon_url: string | null }[];
  created_at: number;
  updated_at: number;
}

/** The Response to POST to the service provider. */
export interface SamlPostback {
  acs_url: string;
  saml_response: string;
  relay_state: string | null;
}

export interface AdminStats {
  users: number;
  teams: number;
  apps: number;
  verified_domains: number;
  active_tokens: number;
  proxied_images?: number;
  trends: {
    users: number[];
    teams: number[];
    apps: number[];
    verified_domains: number[];
  };
}

export interface AdminSecretsStatus {
  /** True when the SECRETS_KEY Cloudflare Secrets Store binding is bound. */
  binding_configured: boolean;
  oauth_apps_total: number;
  oauth_apps_plaintext: number;
  oauth_sources_total: number;
  oauth_sources_plaintext: number;
  user_github_pats_total: number;
  user_github_pats_plaintext: number;
  config_sensitive_total: number;
  config_sensitive_plaintext: number;
}

export interface AdminSecretsMigrateResult {
  encrypted: {
    oauth_apps: number;
    oauth_sources: number;
    user_github_pats: number;
    config_keys: string[];
  };
  before: AdminSecretsStatus;
  after: AdminSecretsStatus;
}

/** Counts for the row-level (D1) bearer-style secrets covered by the
 *  /d1-secrets/* endpoints — separate from /secrets/* which only handles
 *  config-shaped secrets. */
export interface AdminD1SecretsStatus {
  binding_configured: boolean;
  pat_total: number;
  pat_plaintext: number;
  oauth_tokens_total: number;
  oauth_tokens_access_plaintext: number;
  oauth_tokens_refresh_plaintext: number;
  oauth_codes_total: number;
  oauth_codes_plaintext: number;
  site_invites_total: number;
  site_invites_plaintext: number;
  team_invites_total: number;
  team_invites_plaintext: number;
  email_verify_users_total: number;
  email_verify_users_plaintext: number;
  user_emails_verify_total: number;
  user_emails_verify_plaintext: number;
  oauth_2fa_codes_total: number;
  oauth_2fa_codes_plaintext: number;
  totp_authenticators_total: number;
  totp_authenticators_plaintext: number;
  webhooks_total: number;
  webhooks_plaintext: number;
  app_webhooks_total: number;
  app_webhooks_plaintext: number;
  social_connections_access_total: number;
  social_connections_access_plaintext: number;
  social_connections_refresh_total: number;
  social_connections_refresh_plaintext: number;
}

export interface AdminD1SecretsMigrateResult {
  migrated: {
    pat: number;
    oauth_tokens_access: number;
    oauth_tokens_refresh: number;
    oauth_codes: number;
    site_invites: number;
    team_invites: number;
    users_email_verify_token: number;
    users_email_verify_code: number;
    user_emails_verify_token: number;
    user_emails_verify_code: number;
    oauth_2fa_codes: number;
    totp_authenticators: number;
    webhooks: number;
    app_webhooks: number;
    social_connections_access: number;
    social_connections_refresh: number;
  };
  before: AdminD1SecretsStatus;
  after: AdminD1SecretsStatus;
}

export interface AdminUserList {
  /** `is_active` is the raw 0/1 column here. */
  users: (UserProfile & { app_count: number; is_active: number | boolean })[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminUserDetail {
  user: UserProfile & {
    is_active: boolean;
    /** Team whose invite minted this account; null for ordinary accounts. */
    origin_team_id: string | null;
    origin_join_completed: boolean;
    /** When the restriction was lifted; null while it still applies. */
    converted_at: number | null;
  };
  apps: unknown[];
  connections: unknown[];
  sessions: unknown[];
}

// ─── Notification rule types ──────────────────────────────────────────────────

export interface NotifEmail {
  id: string; // "primary" or UUID from user_emails
  email: string;
}

export interface NotifTgConnection {
  id: string;
  name: string;
  username: string | null;
}

export interface NotifDiscordConnection {
  id: string;
  name: string;
  username: string | null;
}

// Notification rule shapes — see src/shared/types.ts.

// ─── Rule-engine ruleset ─────────────────────────────────────────────────────
//
// A ruleset is an ordered list of rules; the active one replaces the
// per-event NotificationRules at dispatch. The shapes are shared with the
// Worker: see src/shared/notificationRules.ts and src/shared/ruleExpression.ts.

export type {
  NotificationLevel,
  NotificationRule as NotificationRulesetRule,
} from "./notificationRules";

export interface NotificationRuleset {
  id: string;
  name: string;
  rules: NotificationRulesetRule[];
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface OAuthSource {
  id: string;
  slug: string;
  provider: string;
  name: string;
  enabled: number;
  created_at: number;
  auth_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  scopes: string | null;
  issuer_url: string | null;
  icon_url: string | null;
  show_icon: number;
  /** 0 = text + icon, 1 = icon-only small, 2 = icon-only large */
  icon_only: number;
  /** 0 = untrusted (users with TOTP get an extra prompt), 1 = trusted */
  trusted: number;
}

export interface SiteInvite {
  id: string;
  token: string;
  email: string | null;
  note: string | null;
  max_uses: number | null;
  use_count: number;
  created_by: string;
  created_by_username: string | null;
  expires_at: number | null;
  created_at: number;
  enabled: boolean;
  token_available?: boolean;
}

export interface AppScopeDefinition {
  id: string;
  app_id: string;
  scope: string;
  title: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface AppScopeAccessRule {
  id: string;
  app_id: string;
  rule_type: "owner_allow" | "owner_deny" | "app_allow" | "app_deny";
  target_id: string;
  created_at: number;
}

export interface AppAccessRule {
  id: string;
  app_id: string;
  rule_type: "team" | "user";
  target_id: string;
  min_role: "owner" | "co-owner" | "admin" | "member" | null;
  created_at: number;
}
