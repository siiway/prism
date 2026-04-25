import { useAuthStore } from "../store/auth";

// API client — all requests go through here

const BASE = "/api";

/**
 * Returns a URL that routes an external image through the worker's sanitizing
 * reverse proxy.  SVGs are stripped of script content before being served.
 * Pass an empty string / nullish value to get back an empty string.
 */
export function proxyImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  const normalized = unproxyImageUrl(url);
  // Already a local asset — no need to proxy
  if (normalized.startsWith("/")) return normalized;
  return `${BASE}/proxy/image?url=${btoa(normalized)}`;
}

/**
 * Converts a proxied image URL (e.g. /api/proxy/image?url=BASE64) back to the
 * original external URL for form inputs.
 */
export function unproxyImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (!parsed.pathname.endsWith("/api/proxy/image")) return trimmed;
    const encoded = parsed.searchParams.get("url");
    if (!encoded) return trimmed;
    return atob(encoded);
  } catch {
    return trimmed;
  }
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
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
    }

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
  resendVerifyEmail: (captcha?: {
    captcha_token?: string;
    pow_challenge?: string;
    pow_nonce?: number;
  }) =>
    request<{ message: string }>(
      "POST",
      "/auth/resend-verify-email",
      captcha ?? {},
      getToken(),
    ),

  emailVerifyCode: (captcha?: {
    captcha_token?: string;
    pow_challenge?: string;
    pow_nonce?: number;
  }) =>
    request<{ address: string; code: string; method: "imap" | "email" }>(
      "POST",
      "/auth/email-verify-code",
      captcha ?? {},
      getToken(),
    ),

  checkEmailVerification: () =>
    request<{ verified: boolean }>(
      "POST",
      "/auth/check-email-verification",
      {},
      getToken(),
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

  // ─── GPG keys ────────────────────────────────────────────────────────────
  listGpgKeys: () =>
    request<{ keys: GpgKeyInfo[] }>("GET", "/user/gpg", undefined, getToken()),
  addGpgKey: (public_key: string, name?: string) =>
    request<GpgKeyInfo>("POST", "/user/gpg", { public_key, name }, getToken()),
  deleteGpgKey: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/user/gpg/${id}`,
      undefined,
      getToken(),
    ),
  gpgChallenge: (identifier: string) =>
    request<{ challenge: string; text: string }>(
      "POST",
      "/auth/gpg-challenge",
      { identifier },
    ),
  gpgLogin: (identifier: string, signed_message: string) =>
    request<{ token: string; user: UserProfile }>("POST", "/auth/gpg-login", {
      identifier,
      signed_message,
    }),

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
  updateMe: (
    body: Partial<{
      display_name: string;
      avatar_url: string;
      alt_email_login: boolean | null;
    }>,
  ) => request<{ user: UserProfile }>("PATCH", "/user/me", body, getToken()),
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

  // ─── Alternate Emails ──────────────────────────────────────────────────
  listEmails: () =>
    request<{
      primary: { email: string; verified: boolean };
      emails: Array<{
        id: string;
        email: string;
        verified: boolean;
        verified_via: string | null;
        created_at: number;
      }>;
    }>("GET", "/user/me/emails", undefined, getToken()),
  addEmail: (email: string) =>
    request<{
      id: string;
      email: string;
      verified: boolean;
      created_at: number;
    }>("POST", "/user/me/emails", { email }, getToken()),
  resendEmailVerify: (id: string) =>
    request<{ message: string }>(
      "POST",
      `/user/me/emails/${id}/resend`,
      {},
      getToken(),
    ),
  setEmailPrimary: (id: string) =>
    request<{ message: string }>(
      "POST",
      `/user/me/emails/${id}/set-primary`,
      {},
      getToken(),
    ),
  removeEmail: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/user/me/emails/${id}`,
      undefined,
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

  // ─── App scope definitions ───────────────────────────────────────────────
  listScopeDefinitions: (appId: string) =>
    request<{ definitions: AppScopeDefinition[] }>(
      "GET",
      `/apps/${appId}/scope-definitions`,
      undefined,
      getToken(),
    ),
  createScopeDefinition: (
    appId: string,
    body: { scope: string; title: string; description?: string },
  ) =>
    request<{ definition: AppScopeDefinition }>(
      "POST",
      `/apps/${appId}/scope-definitions`,
      body,
      getToken(),
    ),
  updateScopeDefinition: (
    appId: string,
    defId: string,
    body: { title?: string; description?: string },
  ) =>
    request<{ definition: AppScopeDefinition }>(
      "PATCH",
      `/apps/${appId}/scope-definitions/${defId}`,
      body,
      getToken(),
    ),
  deleteScopeDefinition: (appId: string, defId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/apps/${appId}/scope-definitions/${defId}`,
      undefined,
      getToken(),
    ),

  // ─── App scope access rules ──────────────────────────────────────────────
  listScopeAccessRules: (appId: string) =>
    request<{ rules: AppScopeAccessRule[] }>(
      "GET",
      `/apps/${appId}/scope-access-rules`,
      undefined,
      getToken(),
    ),
  createScopeAccessRule: (
    appId: string,
    body: { rule_type: AppScopeAccessRule["rule_type"]; target_id: string },
  ) =>
    request<{ rule: AppScopeAccessRule }>(
      "POST",
      `/apps/${appId}/scope-access-rules`,
      body,
      getToken(),
    ),
  deleteScopeAccessRule: (appId: string, ruleId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/apps/${appId}/scope-access-rules/${ruleId}`,
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
  connectionBegin: (slug: string, params: Record<string, string>) =>
    request<{ redirect: string }>(
      "GET",
      `/connections/${slug}/begin?${new URLSearchParams(params)}`,
    ),
  connectionIntent: () =>
    request<{ token: string }>("POST", "/connections/intent", {}, getToken()),
  verifyTelegramAuth: (
    slug: string,
    body: { nonce: string; tg_data: Record<string, string> },
  ) =>
    request<{ type: string; token?: string; pending_key?: string }>(
      "POST",
      `/connections/${slug}/tg-verify`,
      body,
      getToken(),
    ),
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
  refreshConnection: (id: string) =>
    request<{ connection: SocialConnection }>(
      "POST",
      `/connections/${id}/refresh`,
      {},
      getToken(),
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
  revokeToken: (tokenId: string) =>
    request<{ message: string }>(
      "DELETE",
      `/oauth/me/tokens/${encodeURIComponent(tokenId)}`,
      undefined,
      getToken(),
    ),

  // ─── OAuth authorize ─────────────────────────────────────────────────────
  oauthAuthorizeInfo: (params: Record<string, string>) =>
    request<OAuthAuthorizeInfo>(
      "GET",
      `/oauth/app-info?${new URLSearchParams(params)}`,
      undefined,
      getToken(),
    ),
  oauthApprove: (body: OAuthApproveBody) =>
    request<{ redirect: string }>("POST", "/oauth/authorize", body, getToken()),
  passkeyVerifyBegin: () =>
    request<unknown>("POST", "/auth/passkey/verify/begin", {}, getToken()),
  passkeyVerifyFinish: (challenge: string, response: unknown) =>
    request<{ verify_token: string }>(
      "POST",
      "/auth/passkey/verify/finish",
      { challenge, response },
      getToken(),
    ),

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
  adminLoginErrors: (
    page = 1,
    filters: { error_code?: string; identifier?: string; ip?: string } = {},
  ) => {
    const qs = new URLSearchParams({ page: String(page) });
    if (filters.error_code) qs.set("error_code", filters.error_code);
    if (filters.identifier) qs.set("identifier", filters.identifier);
    if (filters.ip) qs.set("ip", filters.ip);
    return request<{ errors: unknown[]; total: number }>(
      "GET",
      `/admin/login-errors?${qs}`,
      undefined,
      getToken(),
    );
  },
  adminRequestLogs: (
    page = 1,
    filters: {
      method?: string;
      path?: string;
      status?: string;
      user_id?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams({ page: String(page) });
    if (filters.method) qs.set("method", filters.method);
    if (filters.path) qs.set("path", filters.path);
    if (filters.status) qs.set("status", filters.status);
    if (filters.user_id) qs.set("user_id", filters.user_id);
    return request<{ logs: unknown[]; total: number }>(
      "GET",
      `/admin/request-logs?${qs}`,
      undefined,
      getToken(),
    );
  },
  adminRequestLogDetails: (id: string) =>
    request<{ details: unknown }>(
      "GET",
      `/admin/request-logs/${id}/details`,
      undefined,
      getToken(),
    ),
  adminExportRequestLogs: async (
    format: "json" | "csv",
    filters: {
      method?: string;
      path?: string;
      status?: string;
      user_id?: string;
    } = {},
  ): Promise<void> => {
    const qs = new URLSearchParams({ format });
    if (filters.method) qs.set("method", filters.method);
    if (filters.path) qs.set("path", filters.path);
    if (filters.status) qs.set("status", filters.status);
    if (filters.user_id) qs.set("user_id", filters.user_id);
    const token = getToken();
    const res = await fetch(`${BASE}/admin/request-logs/export?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `request-logs-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
  adminGetDebug: () =>
    request<{
      logging_enabled: boolean;
      force_log_all: boolean;
      spectate_user_id: string | null;
      spectate_path: string | null;
      log_except_pattern: string | null;
      log_ip: string | null;
    }>("GET", "/admin/debug", undefined, getToken()),
  adminSetDebug: (body: {
    logging_enabled?: boolean;
    force_log_all?: boolean;
    spectate_user_id?: string | null;
    spectate_path?: string | null;
    log_except_pattern?: string | null;
    log_ip?: string | null;
  }) => request<{ ok: boolean }>("POST", "/admin/debug", body, getToken()),
  adminClearRequestLogs: () =>
    request<{ ok: boolean }>(
      "DELETE",
      "/admin/request-logs",
      undefined,
      getToken(),
    ),
  adminClearSpectrateLogs: () =>
    request<{ ok: boolean }>(
      "DELETE",
      "/admin/request-logs/spectate",
      undefined,
      getToken(),
    ),
  adminTestEmail: () =>
    request<{ message: string }>("POST", "/admin/test-email", {}, getToken()),
  adminTestEmailReceiving: () =>
    request<{ message: string; address: string }>(
      "POST",
      "/admin/test-email-receiving",
      {},
      getToken(),
    ),
  adminReset: () =>
    request<{ message: string }>(
      "POST",
      "/admin/reset",
      { confirm: "RESET_EVERYTHING" },
      getToken(),
    ),
  adminMigrateRecoveryCodes: () =>
    request<{ migrated: number }>(
      "POST",
      "/admin/migrate-recovery-codes",
      {},
      getToken(),
    ),

  // ─── Webhooks (admin) ─────────────────────────────────────────────────────
  listWebhooks: () =>
    request<{ webhooks: unknown[] }>(
      "GET",
      "/admin/webhooks",
      undefined,
      getToken(),
    ),
  createWebhook: (body: {
    name: string;
    url: string;
    secret?: string;
    events: string[];
  }) =>
    request<{ webhook: unknown }>("POST", "/admin/webhooks", body, getToken()),
  getWebhook: (id: string) =>
    request<{ webhook: unknown }>(
      "GET",
      `/admin/webhooks/${id}`,
      undefined,
      getToken(),
    ),
  updateWebhook: (
    id: string,
    body: {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      is_active?: boolean;
    },
  ) =>
    request<{ message: string }>(
      "PATCH",
      `/admin/webhooks/${id}`,
      body,
      getToken(),
    ),
  deleteWebhook: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/admin/webhooks/${id}`,
      undefined,
      getToken(),
    ),
  testWebhook: (id: string) =>
    request<{
      success: boolean;
      status: number | null;
      response: string | null;
    }>("POST", `/admin/webhooks/${id}/test`, {}, getToken()),
  listWebhookDeliveries: (id: string) =>
    request<{ deliveries: unknown[] }>(
      "GET",
      `/admin/webhooks/${id}/deliveries`,
      undefined,
      getToken(),
    ),

  // ─── Webhooks (user) ──────────────────────────────────────────────────────
  listUserWebhooks: () =>
    request<{ webhooks: unknown[] }>(
      "GET",
      "/user/webhooks",
      undefined,
      getToken(),
    ),
  createUserWebhook: (body: {
    name: string;
    url: string;
    secret?: string;
    events: string[];
  }) =>
    request<{ webhook: unknown }>("POST", "/user/webhooks", body, getToken()),
  updateUserWebhook: (
    id: string,
    body: {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      is_active?: boolean;
    },
  ) =>
    request<{ message: string }>(
      "PATCH",
      `/user/webhooks/${id}`,
      body,
      getToken(),
    ),
  deleteUserWebhook: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/user/webhooks/${id}`,
      undefined,
      getToken(),
    ),
  testUserWebhook: (id: string) =>
    request<{
      success: boolean;
      status: number | null;
      response: string | null;
    }>("POST", `/user/webhooks/${id}/test`, {}, getToken()),
  listUserWebhookDeliveries: (id: string) =>
    request<{ deliveries: unknown[] }>(
      "GET",
      `/user/webhooks/${id}/deliveries`,
      undefined,
      getToken(),
    ),

  // ─── Notification preferences ─────────────────────────────────────────────
  getNotificationPrefs: () =>
    request<{
      rules: NotificationRules;
      emails: NotifEmail[];
      tg_connections: NotifTgConnection[];
      available: string[];
    }>("GET", "/user/me/notifications", undefined, getToken()),
  updateNotificationPrefs: (rules: NotificationRules) =>
    request<{ rules: NotificationRules }>(
      "PUT",
      "/user/me/notifications",
      { rules },
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

  // Site invites
  adminListInvites: () =>
    request<{ invites: SiteInvite[] }>(
      "GET",
      "/admin/invites",
      undefined,
      getToken(),
    ),
  adminCreateInvite: (body: {
    email?: string;
    note?: string;
    max_uses?: number;
    expires_in_days?: number;
    send_email?: boolean;
  }) =>
    request<{ invite: { id: string; token: string; invite_url: string } }>(
      "POST",
      "/admin/invites",
      body,
      getToken(),
    ),
  adminRevokeInvite: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/admin/invites/${id}`,
      undefined,
      getToken(),
    ),

  // OAuth sources
  adminListOAuthSources: () =>
    request<{ sources: OAuthSource[]; legacy_providers: string[] }>(
      "GET",
      "/admin/oauth-sources",
      undefined,
      getToken(),
    ),
  adminMigrateOAuthSources: () =>
    request<{ migrated: string[]; skipped: string[] }>(
      "POST",
      "/admin/oauth-sources/migrate",
      {},
      getToken(),
    ),
  adminDiscoverOIDC: (issuer: string) =>
    request<{ auth_url: string; token_url: string; userinfo_url: string }>(
      "GET",
      `/admin/oauth-sources/discover?issuer=${encodeURIComponent(issuer)}`,
      undefined,
      getToken(),
    ),
  adminCreateOAuthSource: (body: {
    slug: string;
    provider: string;
    name: string;
    client_id: string;
    client_secret: string;
    auth_url?: string;
    token_url?: string;
    userinfo_url?: string;
    scopes?: string;
    issuer_url?: string;
  }) =>
    request<{ source: OAuthSource }>(
      "POST",
      "/admin/oauth-sources",
      body,
      getToken(),
    ),
  adminUpdateOAuthSource: (
    id: string,
    body: {
      name?: string;
      client_id?: string;
      client_secret?: string;
      enabled?: boolean;
      auth_url?: string;
      token_url?: string;
      userinfo_url?: string;
      scopes?: string;
      issuer_url?: string;
    },
  ) =>
    request<{ message: string }>(
      "PATCH",
      `/admin/oauth-sources/${id}`,
      body,
      getToken(),
    ),
  adminDeleteOAuthSource: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/admin/oauth-sources/${id}`,
      undefined,
      getToken(),
    ),

  // ─── Personal Access Tokens ───────────────────────────────────────────────
  listTokens: () =>
    request<{
      tokens: {
        id: string;
        name: string;
        scopes: string[];
        expires_at: number | null;
        last_used_at: number | null;
        created_at: number;
      }[];
    }>("GET", "/user/tokens", undefined, getToken()),
  createToken: (body: {
    name: string;
    scopes: string[];
    expires_in_days?: number;
  }) =>
    request<{
      id: string;
      name: string;
      token: string;
      scopes: string[];
      expires_at: number | null;
      created_at: number;
    }>("POST", "/user/tokens", body, getToken()),
  revokePat: (id: string) =>
    request<{ message: string }>(
      "DELETE",
      `/user/tokens/${id}`,
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
  invite_only: boolean;
  captcha_provider: string;
  captcha_site_key: string;
  pow_difficulty: number;
  require_email_verification: boolean;
  email_verify_methods: "link" | "send" | "both";
  accent_color: string;
  custom_css: string;
  initialized: boolean;
  r2_enabled: boolean;
  tg_notify_source_slug: string;
  enabled_providers: { slug: string; name: string; provider: string }[];
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
  unproxied_avatar_url: string | null;
  role: "admin" | "user";
  email_verified: boolean;
  alt_email_login: number | null;
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
}

export interface OAuthToken {
  id: string;
  scopes: string[];
  created_at: number;
  expires_at: number;
  is_persistent: boolean;
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
  tokens: OAuthToken[];
}

export interface Team {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  unproxied_avatar_url: string | null;
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
  role: "owner" | "co-owner" | "admin" | "member";
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
  unproxied_icon_url: string | null;
  website_url: string | null;
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  optional_scopes: string[];
  is_public: boolean;
  is_active: boolean;
  is_verified: boolean;
  is_official: boolean;
  is_first_party: boolean;
  use_jwt_tokens: boolean;
  allow_self_manage_exported_permissions: boolean;
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
  optional_scopes?: string[];
  is_public?: boolean;
  use_jwt_tokens?: boolean;
  allow_self_manage_exported_permissions?: boolean;
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
  user: UserProfile | null;
  requires_site_grant: boolean;
  site_scope_confirm_phrase: string | null;
  site_scopes_grantable: boolean;
  requires_team_grant: boolean;
  team_grant_permissions: string[];
  user_admin_teams: Array<{
    id: string;
    name: string;
    avatar_url: string | null;
    role: string;
  }>;
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
  totp_code?: string;
  passkey_verify_token?: string;
  confirm_text?: string;
  team_id?: string;
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

export interface NotificationEmailRule {
  email_id: string;
  level: "brief" | "full";
}

export interface NotificationTgRule {
  connection_id: string;
  level: "brief" | "full";
}

export interface NotificationRule {
  email?: NotificationEmailRule[];
  tg?: NotificationTgRule[];
}

export type NotificationRules = Record<string, NotificationRule>;

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
