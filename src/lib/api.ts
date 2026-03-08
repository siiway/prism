// API client — all requests go through here

const BASE = "/api";

/**
 * Returns a URL that routes an external image through the worker's sanitizing
 * reverse proxy.  SVGs are stripped of script content before being served.
 * Pass an empty string / nullish value to get back an empty string.
 */
export function proxyImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  // Already a local asset — no need to proxy
  if (url.startsWith("/")) return url;
  return `${BASE}/proxy/image?url=${btoa(url)}`;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body instanceof FormData) {
    // Let browser set content-type with boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body:
      body instanceof FormData
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
  });

  const contentType = res.headers.get("Content-Type") ?? "";
  const data = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

function getToken(): string | undefined {
  return localStorage.getItem("token") ?? undefined;
}

export const api = {
  // ─── Init ────────────────────────────────────────────────────────────────
  initStatus: () => request<{ initialized: boolean }>("GET", "/init/status"),
  init: (body: {
    email: string;
    username: string;
    password: string;
    display_name?: string;
    site_name?: string;
  }) => request<{ token: string; user: unknown }>("POST", "/init", body),

  // ─── Site ────────────────────────────────────────────────────────────────
  site: () => request<SitePublicConfig>("GET", "/site"),

  // ─── Auth ────────────────────────────────────────────────────────────────
  register: (body: RegisterBody) =>
    request<AuthResponse>("POST", "/auth/register", body),
  login: (body: LoginBody) =>
    request<LoginResponse>("POST", "/auth/login", body),
  logout: () =>
    request<{ message: string }>("POST", "/auth/logout", undefined, getToken()),
  verifyEmail: (token: string) =>
    request<{ message: string }>(
      "GET",
      `/auth/verify-email?token=${encodeURIComponent(token)}`,
    ),

  // ─── TOTP ────────────────────────────────────────────────────────────────
  totpList: () =>
    request<{
      authenticators: {
        id: string;
        name: string;
        enabled: number;
        created_at: number;
      }[];
      backup_codes_remaining: number;
    }>("GET", "/auth/totp/list", undefined, getToken()),
  totpSetup: (name?: string) =>
    request<{ id: string; secret: string; uri: string }>(
      "POST",
      "/auth/totp/setup",
      { name },
      getToken(),
    ),
  totpVerify: (id: string, code: string) =>
    request<{ message: string; backup_codes?: string[] }>(
      "POST",
      "/auth/totp/verify",
      { id, code },
      getToken(),
    ),
  totpRemove: (id: string, code: string) =>
    request<{ message: string }>(
      "DELETE",
      `/auth/totp/${id}`,
      { code },
      getToken(),
    ),
  totpNewBackupCodes: (code: string) =>
    request<{ backup_codes: string[] }>(
      "POST",
      "/auth/totp/backup-codes",
      { code },
      getToken(),
    ),

  // ─── Passkeys ────────────────────────────────────────────────────────────
  passkeyRegBegin: () =>
    request<unknown>("POST", "/auth/passkey/register/begin", {}, getToken()),
  passkeyRegFinish: (response: unknown, name?: string) =>
    request<{ message: string; id: string }>(
      "POST",
      "/auth/passkey/register/finish",
      { response, name },
      getToken(),
    ),
  passkeyAuthBegin: (username?: string) =>
    request<unknown>("POST", "/auth/passkey/auth/begin", { username }),
  passkeyAuthFinish: (challenge: string, response: unknown) =>
    request<AuthResponse>("POST", "/auth/passkey/auth/finish", {
      challenge,
      response,
    }),
  listPasskeys: () =>
    request<{ passkeys: PasskeyInfo[] }>(
      "GET",
      "/auth/passkeys",
      undefined,
      getToken(),
    ),
  deletePasskey: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/auth/passkeys/${id}`,
      undefined,
      getToken(),
    ),

  // ─── Sessions ────────────────────────────────────────────────────────────
  listSessions: () =>
    request<{ sessions: SessionInfo[] }>(
      "GET",
      "/auth/sessions",
      undefined,
      getToken(),
    ),
  revokeSession: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/auth/sessions/${id}`,
      undefined,
      getToken(),
    ),
  powChallenge: () =>
    request<{ challenge: string; difficulty: number }>(
      "GET",
      "/auth/pow-challenge",
    ),

  // ─── User ────────────────────────────────────────────────────────────────
  me: () => request<MeResponse>("GET", "/user/me", undefined, getToken()),
  updateMe: (body: Partial<{ display_name: string; avatar_url: string }>) =>
    request<{ user: UserProfile }>("PATCH", "/user/me", body, getToken()),
  changePassword: (current_password: string, new_password: string) =>
    request<{ message: string }>(
      "POST",
      "/user/me/change-password",
      { current_password, new_password },
      getToken(),
    ),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return request<{ avatar_url: string }>(
      "POST",
      "/user/me/avatar",
      fd,
      getToken(),
    );
  },
  deleteAccount: (password: string) =>
    request<{ message: string }>(
      "DELETE",
      "/user/me",
      { password, confirm: "DELETE" },
      getToken(),
    ),

  // ─── Apps ────────────────────────────────────────────────────────────────
  listApps: () =>
    request<{ apps: OAuthApp[] }>("GET", "/apps", undefined, getToken()),
  getApp: (id: string) =>
    request<{ app: OAuthApp }>("GET", `/apps/${id}`, undefined, getToken()),
  createApp: (body: CreateAppBody) =>
    request<{ app: OAuthApp }>("POST", "/apps", body, getToken()),
  updateApp: (id: string, body: Partial<CreateAppBody>) =>
    request<{ app: OAuthApp }>("PATCH", `/apps/${id}`, body, getToken()),
  rotateSecret: (id: string) =>
    request<{ client_secret: string }>(
      "POST",
      `/apps/${id}/rotate-secret`,
      {},
      getToken(),
    ),
  deleteApp: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/apps/${id}`,
      undefined,
      getToken(),
    ),

  // ─── Domains ─────────────────────────────────────────────────────────────
  listDomains: () =>
    request<{ domains: Domain[] }>("GET", "/domains", undefined, getToken()),
  addDomain: (domain: string, app_id?: string) =>
    request<DomainAddResponse>(
      "POST",
      "/domains",
      { domain, app_id },
      getToken(),
    ),
  verifyDomain: (id: string) =>
    request<{ verified: boolean; next_reverify_at?: number }>(
      "POST",
      `/domains/${id}/verify`,
      {},
      getToken(),
    ),
  deleteDomain: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/domains/${id}`,
      undefined,
      getToken(),
    ),

  // ─── Connections ─────────────────────────────────────────────────────────
  listConnections: () =>
    request<{ connections: SocialConnection[] }>(
      "GET",
      "/connections",
      undefined,
      getToken(),
    ),
  connectionIntent: () =>
    request<{ token: string }>("POST", "/connections/intent", {}, getToken()),
  connectionPending: (key: string) =>
    request<SocialPendingInfo>(
      "GET",
      `/connections/pending/${encodeURIComponent(key)}`,
    ),
  connectionComplete: (
    body:
      | { key: string; action: "login"; user_id: string }
      | {
          key: string;
          action: "register";
          username: string;
          display_name: string;
        },
  ) =>
    request<{ token: string; user: UserProfile }>(
      "POST",
      "/connections/complete",
      body,
    ),
  disconnectConnection: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/connections/${id}`,
      undefined,
      getToken(),
    ),

  // ─── OAuth consents ──────────────────────────────────────────────────────
  listConsents: () =>
    request<{ consents: OAuthConsent[] }>(
      "GET",
      "/oauth/consents",
      undefined,
      getToken(),
    ),
  revokeConsent: (clientId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/oauth/consents/${encodeURIComponent(clientId)}`,
      undefined,
      getToken(),
    ),

  // ─── OAuth authorize ─────────────────────────────────────────────────────
  oauthAuthorizeInfo: (params: Record<string, string>) =>
    request<OAuthAuthorizeInfo>(
      "GET",
      `/oauth/app-info?${new URLSearchParams(params)}`,
    ),
  oauthApprove: (body: OAuthApproveBody) =>
    request<{ redirect: string }>("POST", "/oauth/authorize", body, getToken()),

  // ─── Admin ────────────────────────────────────────────────────────────────
  adminConfig: () =>
    request<{ config: import("../types").SiteConfig }>(
      "GET",
      "/admin/config",
      undefined,
      getToken(),
    ),
  adminUpdateConfig: (updates: Record<string, unknown>) =>
    request<{ message: string }>("PATCH", "/admin/config", updates, getToken()),
  adminStats: () =>
    request<AdminStats>("GET", "/admin/stats", undefined, getToken()),
  adminListUsers: (page = 1, limit = 20, search = "") =>
    request<AdminUserList>(
      "GET",
      `/admin/users?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
      undefined,
      getToken(),
    ),
  adminGetUser: (id: string) =>
    request<AdminUserDetail>(
      "GET",
      `/admin/users/${id}`,
      undefined,
      getToken(),
    ),
  adminUpdateUser: (id: string, body: Record<string, unknown>) =>
    request<{ message: string }>(
      "PATCH",
      `/admin/users/${id}`,
      body,
      getToken(),
    ),
  adminDeleteUser: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/admin/users/${id}`,
      undefined,
      getToken(),
    ),
  adminListApps: (page = 1) =>
    request<{ apps: OAuthApp[]; total: number }>(
      "GET",
      `/admin/apps?page=${page}`,
      undefined,
      getToken(),
    ),
  adminUpdateApp: (id: string, body: Record<string, unknown>) =>
    request<{ message: string }>(
      "PATCH",
      `/admin/apps/${id}`,
      body,
      getToken(),
    ),
  adminAuditLog: (page = 1) =>
    request<{ logs: unknown[]; total: number }>(
      "GET",
      `/admin/audit-log?page=${page}`,
      undefined,
      getToken(),
    ),
  adminTestEmail: () =>
    request<{ message: string }>("POST", "/admin/test-email", {}, getToken()),
  adminReset: () =>
    request<{ message: string }>(
      "POST",
      "/admin/reset",
      { confirm: "RESET_EVERYTHING" },
      getToken(),
    ),

  // Teams
  listTeams: () =>
    request<{ teams: Team[] }>("GET", "/teams", undefined, getToken()),
  createTeam: (body: {
    name: string;
    description?: string;
    avatar_url?: string;
  }) => request<{ team: Team }>("POST", "/teams", body, getToken()),
  getTeam: (id: string) =>
    request<{ team: Team; members: TeamMember[] }>(
      "GET",
      `/teams/${id}`,
      undefined,
      getToken(),
    ),
  updateTeam: (
    id: string,
    body: { name?: string; description?: string; avatar_url?: string },
  ) => request<{ team: Team }>("PATCH", `/teams/${id}`, body, getToken()),
  deleteTeam: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/teams/${id}`,
      undefined,
      getToken(),
    ),
  addTeamMember: (teamId: string, body: { username: string; role?: string }) =>
    request<{ message: string }>(
      "POST",
      `/teams/${teamId}/members`,
      body,
      getToken(),
    ),
  changeTeamMemberRole: (teamId: string, userId: string, role: string) =>
    request<{ message: string }>(
      "PATCH",
      `/teams/${teamId}/members/${userId}`,
      { role },
      getToken(),
    ),
  removeTeamMember: (teamId: string, userId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/teams/${teamId}/members/${userId}`,
      undefined,
      getToken(),
    ),
  transferOwnership: (teamId: string, userId: string) =>
    request<{ message: string }>(
      "POST",
      `/teams/${teamId}/transfer-ownership`,
      { user_id: userId },
      getToken(),
    ),
  listTeamApps: (teamId: string) =>
    request<{ apps: OAuthApp[] }>(
      "GET",
      `/teams/${teamId}/apps`,
      undefined,
      getToken(),
    ),
  createTeamApp: (teamId: string, body: CreateAppBody) =>
    request<{ app: OAuthApp }>(
      "POST",
      `/teams/${teamId}/apps`,
      body,
      getToken(),
    ),
  transferAppToTeam: (teamId: string, appId: string) =>
    request<{ message: string }>(
      "POST",
      `/teams/${teamId}/apps/transfer`,
      { app_id: appId },
      getToken(),
    ),
  removeAppFromTeam: (teamId: string, appId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/teams/${teamId}/apps/${appId}/transfer`,
      undefined,
      getToken(),
    ),

  // Team domains
  listTeamDomains: (teamId: string) =>
    request<{ domains: Domain[] }>(
      "GET",
      `/teams/${teamId}/domains`,
      undefined,
      getToken(),
    ),
  addTeamDomain: (teamId: string, domain: string) =>
    request<DomainAddResponse>(
      "POST",
      `/teams/${teamId}/domains`,
      { domain },
      getToken(),
    ),
  verifyTeamDomain: (teamId: string, domainId: string) =>
    request<{ verified: boolean; next_reverify_at?: number }>(
      "POST",
      `/teams/${teamId}/domains/${domainId}/verify`,
      undefined,
      getToken(),
    ),
  deleteTeamDomain: (teamId: string, domainId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/teams/${teamId}/domains/${domainId}`,
      undefined,
      getToken(),
    ),
  transferDomainToTeam: (domainId: string, teamId: string) =>
    request<{ message: string }>(
      "POST",
      `/domains/${domainId}/transfer`,
      { team_id: teamId },
      getToken(),
    ),
  returnDomainToPersonal: (teamId: string, domainId: string) =>
    request<{ message: string }>(
      "POST",
      `/teams/${teamId}/domains/${domainId}/to-personal`,
      undefined,
      getToken(),
    ),
  shareDomainToTeam: (domainId: string, teamId: string) =>
    request<{ id: string; domain: string; verified: boolean }>(
      "POST",
      `/domains/${domainId}/share`,
      { team_id: teamId },
      getToken(),
    ),
  shareTeamDomainToTeam: (
    sourceTeamId: string,
    domainId: string,
    targetTeamId: string,
  ) =>
    request<{ id: string; domain: string; verified: boolean }>(
      "POST",
      `/teams/${sourceTeamId}/domains/${domainId}/share-to-team`,
      { team_id: targetTeamId },
      getToken(),
    ),
  shareTeamDomainToPersonal: (teamId: string, domainId: string) =>
    request<{ id: string; domain: string; verified: boolean }>(
      "POST",
      `/teams/${teamId}/domains/${domainId}/share-to-personal`,
      undefined,
      getToken(),
    ),

  // Team invites
  listTeamInvites: (teamId: string) =>
    request<{ invites: TeamInvite[] }>(
      "GET",
      `/teams/${teamId}/invites`,
      undefined,
      getToken(),
    ),
  createTeamInvite: (
    teamId: string,
    body: {
      role?: string;
      email?: string;
      max_uses?: number;
      ttl_hours?: number;
    },
  ) =>
    request<{ invite: TeamInvite }>(
      "POST",
      `/teams/${teamId}/invites`,
      body,
      getToken(),
    ),
  revokeTeamInvite: (teamId: string, token: string) =>
    request<{ message: string }>(
      "DELETE",
      `/teams/${teamId}/invites/${token}`,
      undefined,
      getToken(),
    ),
  getTeamInvite: (token: string) =>
    request<TeamInviteInfo>("GET", `/teams/join/${token}`),
  acceptTeamInvite: (token: string) =>
    request<{ message: string }>(
      "POST",
      `/teams/join/${token}`,
      undefined,
      getToken(),
    ),

  // Admin teams
  adminListTeams: (page = 1) =>
    request<{ teams: AdminTeam[]; total: number }>(
      "GET",
      `/admin/teams?page=${page}`,
      undefined,
      getToken(),
    ),
  adminDeleteTeam: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/admin/teams/${id}`,
      undefined,
      getToken(),
    ),
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SitePublicConfig {
  site_name: string;
  site_description: string;
  site_icon_url: string | null;
  allow_registration: boolean;
  captcha_provider: string;
  captcha_site_key: string;
  pow_difficulty: number;
  accent_color: string;
  custom_css: string;
  initialized: boolean;
  r2_enabled: boolean;
  enabled_providers: string[];
}

export interface RegisterBody {
  email: string;
  username: string;
  password: string;
  display_name?: string;
  captcha_token?: string;
  pow_challenge?: string;
  pow_nonce?: number;
}

export interface LoginBody {
  identifier: string;
  password: string;
  totp_code?: string;
  captcha_token?: string;
  pow_challenge?: string;
  pow_nonce?: number;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
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
  role: "admin" | "user";
  email_verified: boolean;
  created_at?: number;
}

export interface MeResponse {
  user: UserProfile;
  totp_enabled: boolean;
  passkey_count: number;
}

export interface PasskeyInfo {
  id: string;
  name: string | null;
  device_type: string;
  backed_up: number;
  created_at: number;
  last_used_at: number | null;
}

export interface SessionInfo {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: number;
  expires_at: number;
}

export interface OAuthConsent {
  client_id: string;
  scopes: string[];
  granted_at: number;
  app: {
    name: string;
    description: string;
    icon_url: string | null;
    website_url: string | null;
    is_verified: boolean;
  };
}

export interface Team {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  role: string; // current user's role
  my_role?: string;
  created_at: number;
  updated_at: number;
}

export interface TeamMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
  joined_at: number;
}

export interface TeamInvite {
  token: string;
  team_id: string;
  role: string;
  email: string | null;
  max_uses: number;
  uses: number;
  expires_at: number;
  created_at: number;
  created_by_username: string;
}

export interface TeamInviteInfo {
  team: {
    id: string;
    name: string;
    description: string;
    avatar_url: string | null;
  };
  role: string;
  email: string | null;
  expires_at: number;
  user: { id: string; username: string } | null;
  already_member: boolean;
}

export interface AdminTeam {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  member_count: number;
  app_count: number;
  owner_username: string | null;
  created_at: number;
  updated_at: number;
}

export interface OAuthApp {
  id: string;
  name: string;
  description: string;
  icon_url: string | null;
  website_url: string | null;
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_public: boolean;
  is_active: boolean;
  is_verified: boolean;
  is_official: boolean;
  is_first_party: boolean;
  team_id: string | null;
  created_at: number;
  updated_at: number;
  owner_username?: string;
}

export interface CreateAppBody {
  name: string;
  description?: string;
  icon_url?: string;
  website_url?: string;
  redirect_uris: string[];
  allowed_scopes?: string[];
  is_public?: boolean;
}

export interface Domain {
  id: string;
  domain: string;
  verification_token: string;
  verified: number;
  verified_at: number | null;
  next_reverify_at: number | null;
  created_at: number;
}

export interface DomainAddResponse {
  id: string;
  domain: string;
  verification_token: string;
  txt_record: string;
  txt_value: string;
  verified: boolean;
}

export interface SocialPendingInfo {
  type: "register" | "select";
  provider: string;
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
  };
  scopes: string[];
  redirect_uri: string;
  state: string | null;
  user: UserProfile | null;
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
}

export interface AdminStats {
  users: number;
  apps: number;
  verified_domains: number;
  active_tokens: number;
}

export interface AdminUserList {
  users: (UserProfile & { app_count: number })[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminUserDetail {
  user: UserProfile & { is_active: boolean };
  apps: unknown[];
  connections: unknown[];
  sessions: unknown[];
}
