import type {
  NotificationEmailRule,
  NotificationTgRule,
  NotificationDiscordRule,
  NotificationRule,
  NotificationRules,
  RestrictedCapability,
  TeamCapability,
  TeamRolePermissions,
} from "../../shared/types";

import type { NotificationRule as NotificationRulesetRule } from "../../shared/notificationRules";
import type {
  ImageProxyResourceType,
  KvNamespaceKey,
  MaintenanceJobKey,
} from "../../shared/codes";
import { useEffect, useState } from "react";
import type { i18n as I18n } from "i18next";
import { clientI18n } from "../i18n/init";
import { authStore } from "../store/auth";
import { isNormalView } from "../store/adminView";
import type {
  TurnstileVariant,
  CaptchaProvider,
  GeetestOutput,
  SitePublicConfig,
  LegalDocType,
  LegalDoc,
  AdminLegalDocument,
  RegisterBody,
  LoginBody,
  SessionUser,
  AuthResponse,
  LoginResponse,
  UserProfile,
  PublicUserProfile,
  MeResponse,
  PasskeyInfo,
  GpgKeyInfo,
  SessionInfo,
  SessionIpInfo,
  OAuthConsent,
  JoinPageInfo,
  JoinRequirements,
  RestrictionInfo,
  Team,
  TeamGroup,
  MemberGroup,
  SubTeamListItem,
  PublicTeamProfile,
  TeamMember,
  TeamInvite,
  TeamInviteInfo,
  AdminTeam,
  AdminUserSecurity,
  AdminUserToken,
  AdminUserConnection,
  AdminUserGpgKey,
  AdminUserEmails,
  AdminUserDomain,
  AdminUserAuthorization,
  AdminUserTeam,
  DbTable,
  DbRowPage,
  DbQueryResult,
  KvKeyPage,
  KvEntry,
  AdminDomain,
  ScopeGrantKind,
  AdminScopeGrant,
  AdminScopeGrantDetail,
  Notice,
  AdminNotice,
  NoticeInput,
  AdminTeamInvite,
  AdminSession,
  OAuthApp,
  CreatedOAuthApp,
  CreateAppBody,
  SearchHit,
  AuditEventsResponse,
  AuditQuery,
  AuditWebhook,
  AuditWebhookInput,
  VerificationMethod,
  Domain,
  DomainAddResponse,
  DomainVerifyResponse,
  SocialPendingInfo,
  Social2faPendingInfo,
  SocialConnection,
  OAuthAuthorizeInfo,
  OAuth2FAInfo,
  OAuth2FAAuthorizeBody,
  OAuthApproveBody,
  DeviceVerifyInfo,
  AdminStats,
  AdminSecretsStatus,
  AdminSecretsMigrateResult,
  AdminD1SecretsStatus,
  AdminD1SecretsMigrateResult,
  AdminUserList,
  AdminUserDetail,
  NotifEmail,
  NotifTgConnection,
  NotifDiscordConnection,
  NotificationRuleset,
  OAuthSource,
  SiteInvite,
  AppScopeDefinition,
  AppScopeAccessRule,
  AppAccessRule,
  AdminSamlSetting,
  AppSamlInfo,
  SamlServiceProvider,
  SamlUpdateBody,
  SamlRequestInfo,
  SamlPostback,
  SamlLogoutStep,
  SamlProfile,
} from "../../shared/api";

export type {
  NotificationEmailRule,
  NotificationTgRule,
  NotificationDiscordRule,
  NotificationRule,
  NotificationRules,
  RestrictedCapability,
  TeamCapability,
  TeamRolePermissions,
};
export type * from "../../shared/api";
export {
  NOTICE_AUDIENCES,
  NOTICE_LEVELS,
  REDIRECT_URI_MATCH_TYPES,
  VERIFICATION_METHODS,
} from "../../shared/api";

// API client — all requests go through here

const BASE = "/api";

/**
 * Register an external image URL with the worker's sanitizing image proxy
 * and return the public proxy URL the browser can fetch.
 *
 * The proxy no longer accepts arbitrary URLs on the request — every served
 * URL must be in the image_proxy_mappings table. Server-side renders
 * register on demand; from the client we hit POST /api/proxy/image/register
 * (auth required) so user-supplied URLs (markdown <img>, etc.) get an id
 * the proxy will resolve.
 *
 * Returns "" for nullish/empty input. Local assets (starting with "/") and
 * already-proxied URLs (paths under /api/proxy/image/) are returned as-is.
 * Failures fall back to "" so the caller can hide the broken image rather
 * than render a dead URL.
 */
const proxyRegisterCache = new Map<string, Promise<string>>();

export async function proxyImageUrl(
  url: string | null | undefined,
): Promise<string> {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  // Already routed through the proxy — leave it alone.
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.startsWith("/api/proxy/image/")) return trimmed;
  } catch {
    return "";
  }
  const cached = proxyRegisterCache.get(trimmed);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const { id } = await performRequest<{ id: string }>(
        {},
        "POST",
        "/proxy/image/register",
        { url: trimmed },
      );
      return `${BASE}/proxy/image/${id}`;
    } catch {
      proxyRegisterCache.delete(trimmed);
      return "";
    }
  })();
  proxyRegisterCache.set(trimmed, pending);
  return pending;
}

/**
 * Hook variant of proxyImageUrl. Returns "" until the URL has been
 * registered with the proxy, then the public proxy URL. Use this anywhere
 * the JSX needs to drop the resolved URL into <img src=…> directly —
 * keeps the registration round trip out of render.
 */
export function useProxiedImage(url: string | null | undefined): string {
  const [resolved, setResolved] = useState<{ url: string; src: string } | null>(
    null,
  );
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    proxyImageUrl(url).then((src) => {
      if (!cancelled) setResolved({ url, src });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  // Return the cached value only if it matches the current url, so stale
  // resolutions from a previous prop don't paint between renders.
  return resolved && resolved.url === url ? resolved.src : "";
}

/**
 * Returns the original external URL for a value that may have been sent as
 * a proxied URL by the server. The new id-based proxy format can't be
 * reversed client-side (the URL only lives in the server-side mapping
 * table), so callers should prefer the `unproxied_*` field the API
 * returns alongside any proxied URL. This helper is retained for the
 * legacy `?url=BASE64` form and for plain pass-through.
 */
export function unproxyImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.endsWith("/api/proxy/image")) {
      const encoded = parsed.searchParams.get("url");
      if (encoded) return atob(encoded);
    }
    // New id-based format — the original URL is only known server-side.
    if (parsed.pathname.startsWith("/api/proxy/image/")) return "";
  } catch {
    return trimmed;
  }
  return trimmed;
}

// Error codes the worker's auth middleware uses when it rejects a
// request because the session/PAT itself is no good. Anything else
// returning 401 is a business-logic failure (insufficient scope,
// upstream provider auth dead, etc.) and must not log the user out.
const SESSION_INVALID_ERRORS = new Set(["unauthorized", "token_expired"]);

export type ApiErrorParams = Record<string, string | number>;

/** A failed request. The API answers with a stable code
 *  (`{ error: "field_required", params: { field: "name" } }`), never with
 *  English; `message` is that code translated into the reader's language,
 *  so it can be shown as is. Compare against `code`, never `message`. */
export class ApiError extends Error {
  status: number;
  data: unknown;
  code: string;
  params: ApiErrorParams | undefined;
  constructor(
    status: number,
    message: string,
    data?: unknown,
    code = message,
    params?: ApiErrorParams,
  ) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = code;
    this.params = params;
  }
}

/** Translates an error code; see ApiClientOptions.translate. */
export type ApiErrorTranslator = (
  code: string,
  params?: ApiErrorParams,
) => string;

/** A translator over an i18next instance: `apiErrors.<code>`, or a generic
 *  "something went wrong (code)" when this build doesn't know the code. */
export function i18nErrorTranslator(i18n: I18n): ApiErrorTranslator {
  return (code, params) => {
    const key = `apiErrors.${code}`;
    return i18n.exists(key)
      ? i18n.t(key, params)
      : i18n.t("apiErrors.unknown", { code });
  };
}

export type ApiFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ApiClientOptions {
  /** Request-local transport. Required by SSR because Worker fetch rejects relative URLs. */
  fetcher?: ApiFetcher;
  /** Optional non-browser credential source. The web client deliberately omits it. */
  getToken?: () => string | undefined;
  /** Browser-only view override; SSR must explicitly keep this false. */
  isNormalView?: () => boolean;
  /** Browser-only callback for an invalid Prism session. */
  onInvalidSession?: () => void;
  /** Turns an error code into text for ApiError.message. Without one the
   *  message is the bare code. */
  translate?: ApiErrorTranslator;
}

async function performRequest<T>(
  options: ApiClientOptions,
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

  // A site admin who has switched to "normal view" asks the worker to drop
  // their site-admin override and treat team requests as their own membership.
  // The flag is session-only and defaults on (see store/adminView). Admin-panel
  // navigation turns it off before opening a team/app resource.
  if (options.isNormalView?.()) headers["X-Prism-Team-View"] = "member";

  // The browser client uses global fetch. SSR injects a request-bound
  // in-process dispatcher instead; never publish that dispatcher globally,
  // because Worker isolates may interleave multiple renders.
  const doFetch = options.fetcher ?? fetch;

  const res = await doFetch(`${BASE}${path}`, {
    method,
    headers,
    // Browser sessions authenticate exclusively with the HttpOnly cookie.
    // `credentials: include` also lets request-local SSR fetchers forward the
    // incoming cookie without exposing its value to application JavaScript.
    credentials: "include",
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
    const body =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : null;
    const sent = typeof body?.error === "string" ? body.error : null;
    const code = sent ?? "http_error";
    const params =
      sent && typeof body?.params === "object" && body.params !== null
        ? (body.params as ApiErrorParams)
        : sent
          ? undefined
          : { status: res.status };
    const message = options.translate?.(code, params) ?? code;

    // Only clear local session state for 401s that actually mean "your
    // Prism session is invalid". Other 401-shaped errors (OAuth scope
    // failures, dead upstream provider tokens on a connection refresh,
    // PAT scope rejections, etc.) carry a specific error code and must
    // NOT log the user out.
    if (res.status === 401 && SESSION_INVALID_ERRORS.has(code)) {
      options.onInvalidSession?.();
    }

    throw new ApiError(res.status, message, data, code, params);
  }

  return data as T;
}

type ApiRequest = <T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) => Promise<T>;

const buildApi = (request: ApiRequest, getToken: () => string | undefined) => ({
  // ─── Init ────────────────────────────────────────────────────────────────
  initStatus: () => request<{ initialized: boolean }>("GET", "/init/status"),
  init: (body: {
    email: string;
    username: string;
    password: string;
    display_name?: string;
    site_name?: string;
  }) => request<{ user: SessionUser }>("POST", "/init", body),

  // ─── Site ────────────────────────────────────────────────────────────────
  site: () => request<SitePublicConfig>("GET", "/site"),
  /** Fetch an operator-authored legal page ("privacy" | "terms"). Public —
   *  the pages are reachable without signing in. `content` is raw markdown
   *  (empty when unpublished); render it through renderMarkdown. */
  legal: (doc: LegalDocType) => request<LegalDoc>("GET", `/legal/${doc}`),

  // ─── Auth ────────────────────────────────────────────────────────────────
  register: (body: RegisterBody) =>
    request<AuthResponse | { ok: true }>("POST", "/auth/register", body),

  // ── Team-invite registration ────────────────────────────────────────────
  joinPageInfo: (teamId: string) =>
    request<JoinPageInfo>("GET", `/join/${encodeURIComponent(teamId)}`),
  registerWithInvite: (body: {
    team_id: string;
    invite_token: string;
    username: string;
    password: string;
    display_name?: string;
    /** Omitted when the team's invite path skips email collection. */
    email?: string;
    provider?: CaptchaProvider;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    geetest?: GeetestOutput;
    cap_token?: string;
  }) =>
    request<{
      user: SessionUser;
      pending: true;
      requirements: JoinRequirements;
      synthetic_email: boolean;
    }>("POST", "/auth/register-with-invite", body),
  inviteJoinStatus: () =>
    request<{
      team: { id: string; name: string; avatar_url: string | null };
      requirements: JoinRequirements;
      unmet: string[];
      synthetic_email: boolean;
    }>("GET", "/auth/invite-join/status", undefined, getToken()),
  completeInviteJoin: () =>
    request<{ team_id: string }>(
      "POST",
      "/auth/invite-join/complete",
      undefined,
      getToken(),
    ),
  myRestriction: () =>
    request<RestrictionInfo>(
      "GET",
      "/user/me/restriction",
      undefined,
      getToken(),
    ),
  convertAccount: () =>
    request<{ converted_at: number }>(
      "POST",
      "/user/me/convert",
      undefined,
      getToken(),
    ),
  login: (body: LoginBody) =>
    request<LoginResponse>("POST", "/auth/login", body),
  /** Revoke the cookie-authenticated session and clear its cookie. */
  /** `saml_logout`: a page to visit next, which signs the user out of the
   *  SAML apps of this session before going on to /login. */
  logout: () =>
    request<{ ok: true; saml_logout: string | null }>(
      "POST",
      "/auth/logout",
      undefined,
      getToken(),
    ),
  verifyEmail: (token: string) =>
    request<{ ok: true }>(
      "GET",
      `/auth/verify-email?token=${encodeURIComponent(token)}`,
    ),
  resendVerifyEmail: (captcha?: {
    provider?: CaptchaProvider;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    geetest?: GeetestOutput;
    cap_token?: string;
  }) =>
    request<{ ok: true }>(
      "POST",
      "/auth/resend-verify-email",
      captcha ?? {},
      getToken(),
    ),

  emailVerifyCode: (captcha?: {
    provider?: CaptchaProvider;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    geetest?: GeetestOutput;
    cap_token?: string;
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
    request<{ backup_codes?: string[] }>(
      "POST",
      "/auth/totp/verify",
      { id, code },
      getToken(),
    ),
  totpRemove: (id: string, code: string) =>
    request<{ ok: true }>("DELETE", `/auth/totp/${id}`, { code }, getToken()),
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
    request<{ id: string }>(
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
    request<{ ok: true }>(
      "DELETE",
      `/auth/passkeys/${id}`,
      undefined,
      getToken(),
    ),

  // ─── GPG keys ────────────────────────────────────────────────────────────
  listGpgKeys: () =>
    request<{ keys: GpgKeyInfo[] }>("GET", "/user/gpg", undefined, getToken()),
  addGpgKey: (public_key: string, name?: string) =>
    request<{ keys: GpgKeyInfo[]; added: number; skipped: number }>(
      "POST",
      "/user/gpg",
      { public_key, name },
      getToken(),
    ),
  deleteGpgKey: (id: string) =>
    request<{ ok: true }>("DELETE", `/user/gpg/${id}`, undefined, getToken()),
  gpgChallenge: (identifier: string) =>
    request<{ challenge: string; text: string }>(
      "POST",
      "/auth/gpg-challenge",
      { identifier },
    ),
  /** Returns `{ totp_required: true }` instead of a session when the account
   *  has 2FA enabled — resubmit the same signed message with `totp_code`. */
  gpgLogin: (identifier: string, signed_message: string, totp_code?: string) =>
    request<{
      user?: SessionUser;
      totp_required?: boolean;
    }>("POST", "/auth/gpg-login", {
      identifier,
      signed_message,
      totp_code,
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
    request<{ ok: true }>(
      "DELETE",
      `/auth/sessions/${id}`,
      undefined,
      getToken(),
    ),
  listSessionIps: (id: string) =>
    request<{ ips: SessionIpInfo[] }>(
      "GET",
      `/auth/sessions/${id}/ips`,
      undefined,
      getToken(),
    ),
  revokeAllOtherSessions: () =>
    request<{ revoked: number }>(
      "DELETE",
      "/auth/sessions",
      undefined,
      getToken(),
    ),
  // ─── User ────────────────────────────────────────────────────────────────
  me: () => request<MeResponse>("GET", "/user/me", undefined, getToken()),
  updateMe: (
    body: Partial<{
      display_name: string;
      avatar_url: string;
      alt_email_login: boolean | null;
      access_token_ttl_minutes: number | null;
      refresh_token_ttl_days: number | null;
      notify_on_auto_authorization: boolean;
      gpg_require_2fa: boolean;
      profile_is_public: boolean;
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
      profile_readme: string | null;
      profile_readme_source: "manual" | "github";
      profile_readme_source_meta: {
        connection_id?: string | null;
        github_login?: string;
      } | null;
      github_readme_token: string | null;
    }>,
  ) => request<{ user: UserProfile }>("PATCH", "/user/me", body, getToken()),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: true }>(
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
  uploadReadme: (file: File) => {
    const fd = new FormData();
    fd.append("readme", file);
    return request<{
      profile_readme: string | null;
      profile_readme_updated_at: number | null;
      max_bytes: number;
    }>("POST", "/user/me/readme", fd, getToken());
  },
  syncReadmeFromGithub: () =>
    request<{ status: number; synced_at?: number; error?: string }>(
      "POST",
      "/user/me/readme/sync",
      {},
      getToken(),
    ),
  deleteAccount: (password: string) =>
    request<{ ok: true }>(
      "DELETE",
      "/user/me",
      { password, confirm: "DELETE" },
      getToken(),
    ),
  getPublicProfile: (username: string) =>
    request<{ profile: PublicUserProfile }>(
      "GET",
      `/users/${encodeURIComponent(username)}`,
      undefined,
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
    request<{ ok: true }>(
      "POST",
      `/user/me/emails/${id}/resend`,
      {},
      getToken(),
    ),
  setEmailPrimary: (id: string) =>
    request<{ ok: true }>(
      "POST",
      `/user/me/emails/${id}/set-primary`,
      {},
      getToken(),
    ),
  removeEmail: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/user/me/emails/${id}`,
      undefined,
      getToken(),
    ),

  // ─── Apps ────────────────────────────────────────────────────────────────
  listApps: (params: { page?: number; limit?: number; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      apps: OAuthApp[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/apps${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
  getApp: (id: string) =>
    request<{ app: OAuthApp }>("GET", `/apps/${id}`, undefined, getToken()),
  createApp: (body: CreateAppBody) =>
    request<{ app: CreatedOAuthApp }>("POST", "/apps", body, getToken()),
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
    request<{ ok: true }>("DELETE", `/apps/${id}`, undefined, getToken()),

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
    request<{ ok: true }>(
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
    request<{ ok: true }>(
      "DELETE",
      `/apps/${appId}/scope-access-rules/${ruleId}`,
      undefined,
      getToken(),
    ),

  // ─── App access whitelist rules ─────────────────────────────────────────
  listAccessRules: (appId: string) =>
    request<{ rules: AppAccessRule[] }>(
      "GET",
      `/apps/${appId}/access-rules`,
      undefined,
      getToken(),
    ),
  createAccessRule: (
    appId: string,
    body: {
      rule_type: "team" | "user";
      target_id: string;
      min_role?: "owner" | "co-owner" | "admin" | "member";
    },
  ) =>
    request<{ rule: AppAccessRule }>(
      "POST",
      `/apps/${appId}/access-rules`,
      body,
      getToken(),
    ),
  deleteAccessRule: (appId: string, ruleId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/apps/${appId}/access-rules/${ruleId}`,
      undefined,
      getToken(),
    ),

  // ─── App SAML service provider ──────────────────────────────────────────
  getAppSaml: (appId: string) =>
    request<AppSamlInfo>("GET", `/apps/${appId}/saml`, undefined, getToken()),
  updateAppSaml: (appId: string, body: SamlUpdateBody) =>
    request<{ saml: SamlServiceProvider }>(
      "PUT",
      `/apps/${appId}/saml`,
      body,
      getToken(),
    ),
  deleteAppSaml: (appId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/apps/${appId}/saml`,
      undefined,
      getToken(),
    ),

  // ─── SAML sign-in page ──────────────────────────────────────────────────
  getSamlRequest: (token: string) =>
    request<SamlRequestInfo>(
      "GET",
      `/saml/requests/${encodeURIComponent(token)}`,
      undefined,
      getToken(),
    ),
  /** `profile`: on a first sign-in, the shared profile the app gets
   *  (its id), or "new" for a new per-app profile. */
  samlDecision: (
    token: string,
    action: "approve" | "deny" | "decline",
    authorizationMode?: "once" | "always",
    profile?: string,
  ) =>
    request<SamlPostback>(
      "POST",
      `/saml/requests/${encodeURIComponent(token)}`,
      { action, authorization_mode: authorizationMode, profile },
      getToken(),
    ),
  listSamlProfiles: () =>
    request<{ profiles: SamlProfile[] }>(
      "GET",
      "/saml/profiles",
      undefined,
      getToken(),
    ),
  getSamlProfile: (id: string) =>
    request<{ profile: SamlProfile }>(
      "GET",
      `/saml/profiles/${encodeURIComponent(id)}`,
      undefined,
      getToken(),
    ),
  createSamlProfile: (name: string) =>
    request<{ profile: SamlProfile }>(
      "POST",
      "/saml/profiles",
      { name },
      getToken(),
    ),
  renameSamlProfile: (id: string, name: string) =>
    request<{ profile: SamlProfile }>(
      "PATCH",
      `/saml/profiles/${encodeURIComponent(id)}`,
      { name },
      getToken(),
    ),
  /** Turn a per-app profile into a shared one; it keeps its ID. */
  shareSamlProfile: (id: string, name: string) =>
    request<{ profile: SamlProfile }>(
      "POST",
      `/saml/profiles/${encodeURIComponent(id)}/share`,
      { name },
      getToken(),
    ),
  deleteSamlProfile: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/saml/profiles/${encodeURIComponent(id)}`,
      undefined,
      getToken(),
    ),
  /** `token`: a logout another site asked for (from the page URL); null
   *  for the one this browser began. `action` answers a "confirm" step. */
  samlLogoutStep: (token: string | null, action?: "confirm" | "cancel") =>
    request<SamlLogoutStep>(
      "POST",
      "/saml/logout",
      { token: token ?? undefined, action },
      getToken(),
    ),

  // ─── Domains ─────────────────────────────────────────────────────────────
  listDomains: (params: { page?: number; limit?: number; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      domains: Domain[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/domains${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
  getDomain: (id: string) =>
    request<{ domain: Domain }>("GET", `/domains/${id}`, undefined, getToken()),
  addDomain: (domain: string, app_id?: string) =>
    request<DomainAddResponse>(
      "POST",
      "/domains",
      { domain, app_id },
      getToken(),
    ),
  verifyDomain: (id: string, method?: VerificationMethod) =>
    request<DomainVerifyResponse>(
      "POST",
      `/domains/${id}/verify`,
      method ? { method } : {},
      getToken(),
    ),
  deleteDomain: (id: string) =>
    request<{ ok: true }>("DELETE", `/domains/${id}`, undefined, getToken()),

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
    request<{ type: string; pending_key?: string }>(
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
    request<{ user: SessionUser } | { type: "2fa"; pending_key: string }>(
      "POST",
      "/connections/complete",
      body,
    ),
  connectionSocial2faPending: (key: string) =>
    request<Social2faPendingInfo>(
      "GET",
      `/connections/2fa/pending/${encodeURIComponent(key)}`,
    ),
  connectionSocial2faVerify: (body: { key: string; totp_code: string }) =>
    request<{ user: SessionUser }>("POST", "/connections/2fa/verify", body),
  refreshConnection: (id: string) =>
    request<{ connection: SocialConnection }>(
      "POST",
      `/connections/${id}/refresh`,
      {},
      getToken(),
    ),
  disconnectConnection: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/connections/${id}`,
      undefined,
      getToken(),
    ),

  // ─── OAuth consents ──────────────────────────────────────────────────────
  listConsents: (
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      consents: OAuthConsent[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/oauth/consents${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
  revokeConsent: (clientId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/oauth/consents/${encodeURIComponent(clientId)}`,
      undefined,
      getToken(),
    ),
  updateConsent: (clientId: string, body: { auto_authorize?: boolean }) =>
    request<{ ok: true }>(
      "PATCH",
      `/oauth/consents/${encodeURIComponent(clientId)}`,
      body,
      getToken(),
    ),
  revokeToken: (tokenId: string) =>
    request<{ ok: true }>(
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

  // ─── Device Authorization Grant (RFC 8628) verification screen ───────────
  deviceVerifyInfo: (userCode: string) =>
    request<DeviceVerifyInfo>(
      "GET",
      `/oauth/device?user_code=${encodeURIComponent(userCode)}`,
      undefined,
      getToken(),
    ),
  deviceDecision: (userCode: string, action: "approve" | "deny") =>
    request<{ status: "approved" | "denied" }>(
      "POST",
      "/oauth/device/decision",
      { user_code: userCode, action },
      getToken(),
    ),

  // ─── OAuth 2FA step-up ───────────────────────────────────────────────────
  oauth2faInfo: (params: Record<string, string>) =>
    request<OAuth2FAInfo>(
      "GET",
      `/oauth/2fa/info?${new URLSearchParams(params)}`,
      undefined,
      getToken(),
    ),
  oauth2faAuthorize: (body: OAuth2FAAuthorizeBody) =>
    request<{ redirect: string }>(
      "POST",
      "/oauth/2fa/authorize",
      body,
      getToken(),
    ),

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
    request<{ ok: true }>("PATCH", "/admin/config", updates, getToken()),
  /** Both legal documents (Privacy Policy, Terms of Service), with full
   *  content, for the admin editor. Missing documents come back with empty
   *  content. 503 with `migrations_pending` if the table isn't there yet. */
  adminLegal: () =>
    request<{ documents: AdminLegalDocument[] }>(
      "GET",
      "/admin/legal",
      undefined,
      getToken(),
    ),
  /** Publish, edit, or clear one legal document. An empty string unpublishes
   *  it (hides the page and its footer link). */
  adminUpdateLegal: (doc: LegalDocType, content: string) =>
    request<LegalDoc>("PUT", `/admin/legal/${doc}`, { content }, getToken()),
  adminSecretsStatus: () =>
    request<AdminSecretsStatus>(
      "GET",
      "/admin/secrets/status",
      undefined,
      getToken(),
    ),
  adminMigrateSecrets: () =>
    request<AdminSecretsMigrateResult>(
      "POST",
      "/admin/secrets/migrate",
      {},
      getToken(),
    ),
  adminD1SecretsStatus: () =>
    request<AdminD1SecretsStatus>(
      "GET",
      "/admin/d1-secrets/status",
      undefined,
      getToken(),
    ),
  adminMigrateD1Secrets: () =>
    request<AdminD1SecretsMigrateResult>(
      "POST",
      "/admin/d1-secrets/migrate",
      {},
      getToken(),
    ),
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
    request<{ ok: true }>("PATCH", `/admin/users/${id}`, body, getToken()),
  adminDeleteUser: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}`,
      undefined,
      getToken(),
    ),
  adminListApps: (page = 1, search = "") =>
    request<{ apps: OAuthApp[]; total: number }>(
      "GET",
      `/admin/apps?page=${page}&search=${encodeURIComponent(search)}`,
      undefined,
      getToken(),
    ),
  adminUpdateApp: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>("PATCH", `/admin/apps/${id}`, body, getToken()),
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
  adminTestEmail: () =>
    request<{ ok: true }>("POST", "/admin/test-email", {}, getToken()),
  adminTestEmailReceiving: () =>
    request<{ address: string }>(
      "POST",
      "/admin/test-email-receiving",
      {},
      getToken(),
    ),
  // Back-compat alias — older callers used `adminReset()` to perform a reset
  // in one shot. The new flow requires request → cooldown → confirm. We keep
  // this entry point so existing code paths still resolve; under the hood it
  // routes to the confirmation endpoint, which will refuse without an
  // already-pending request and a passed cooldown.
  adminReset: () =>
    request<{ ok: true }>(
      "POST",
      "/admin/reset/confirm",
      { confirm: "RESET_EVERYTHING" },
      getToken(),
    ),
  adminResetStatus: () =>
    request<{
      enabled: boolean;
      cooldown_required: boolean;
      cooldown_seconds: number;
      sudo_active: boolean;
      pending: {
        requested_at: number;
        eligible_at: number;
        requested_by_self: boolean;
      } | null;
    }>("GET", "/admin/reset/status", undefined, getToken()),
  adminResetRequest: (body: { totp_code?: string }) =>
    request<{ requested_at: number; eligible_at: number }>(
      "POST",
      "/admin/reset/request",
      body,
      getToken(),
    ),
  adminResetCancel: () =>
    request<{ cancelled: boolean }>(
      "POST",
      "/admin/reset/cancel",
      {},
      getToken(),
    ),
  adminResetConfirm: (body: { totp_code?: string }) =>
    request<{ ok: true }>(
      "POST",
      "/admin/reset/confirm",
      { confirm: "RESET_EVERYTHING", ...body },
      getToken(),
    ),
  adminMigrateRecoveryCodes: () =>
    request<{ migrated: number }>(
      "POST",
      "/admin/migrate-recovery-codes",
      {},
      getToken(),
    ),
  adminRecoveryCodesStatus: () =>
    request<{ total: number; unmigrated: number }>(
      "GET",
      "/admin/migrate-recovery-codes-status",
      undefined,
      getToken(),
    ),
  adminSaml: (kind: "users" | "apps", id: string) =>
    request<AdminSamlSetting>(
      "GET",
      `/admin/${kind}/${encodeURIComponent(id)}/saml`,
      undefined,
      getToken(),
    ),
  adminSetSaml: (
    kind: "users" | "apps",
    id: string,
    override: boolean | null,
  ) =>
    request<AdminSamlSetting>(
      "PATCH",
      `/admin/${kind}/${encodeURIComponent(id)}/saml`,
      { override },
      getToken(),
    ),
  adminSetInviteRegistration: (
    teamId: string,
    body: {
      granted?: boolean;
      exemptions?: { email_verification?: boolean };
      /** Override the site default, or null to follow it again. */
      allow_convert?: boolean | null;
    },
  ) =>
    request<{
      invite_registration_granted: boolean;
      invite_registration_allow_convert: boolean | null;
      invite_registration_exemptions: { email_verification?: boolean };
    }>(
      "PATCH",
      `/admin/teams/${encodeURIComponent(teamId)}/invite-registration`,
      body,
      getToken(),
    ),
  adminStartDissolve: (teamId: string, confirm: string) =>
    request<{ deactivated_accounts: number }>(
      "POST",
      `/admin/teams/${encodeURIComponent(teamId)}/dissolve`,
      { confirm },
      getToken(),
    ),
  adminCancelDissolve: (teamId: string) =>
    request<{ ok: true }>(
      "POST",
      `/admin/teams/${encodeURIComponent(teamId)}/dissolve/cancel`,
      undefined,
      getToken(),
    ),
  adminListRestrictedUsers: (params: {
    team_id?: string;
    invite_token?: string;
  }) =>
    request<{
      users: Array<{
        id: string;
        username: string;
        email: string;
        is_active: number;
        created_at: number;
        origin_team_id: string;
        origin_join_completed: number;
        converted_at: number | null;
      }>;
    }>(
      "GET",
      `/admin/restricted-users?${new URLSearchParams(params as Record<string, string>).toString()}`,
      undefined,
      getToken(),
    ),
  adminTeamsAsUsersStatus: () =>
    request<{
      teams_total: number;
      teams_mirrored: number;
      team_apps_total: number;
      team_apps_aligned: number;
    }>("GET", "/admin/teams-as-users-status", undefined, getToken()),
  adminMigrateTeamsAsUsers: () =>
    request<{ teams_mirrored: number; apps_realigned: number }>(
      "POST",
      "/admin/migrate-teams-as-users",
      {},
      getToken(),
    ),
  adminImageProxyStatus: () =>
    request<{
      discovered: number;
      mapped: number;
      cached: number;
      cached_bytes: number;
      cache_mode: "off" | "kv" | "d1";
      images_binding: boolean;
    }>("GET", "/admin/image-proxy-status", undefined, getToken()),
  adminMigrateImageProxy: () =>
    request<{ registered: number }>(
      "POST",
      "/admin/migrate-image-proxy",
      {},
      getToken(),
    ),
  adminListImageProxy: (
    page: number,
    opts?: { q?: string; created_by?: string; limit?: number },
  ) => {
    const p = new URLSearchParams({ page: String(page) });
    if (opts?.q) p.set("q", opts.q);
    if (opts?.created_by) p.set("created_by", opts.created_by);
    if (opts?.limit) p.set("limit", String(opts.limit));
    return request<{
      mappings: {
        id: string;
        url: string;
        created_by: string | null;
        created_at: number;
        created_by_username: string | null;
        created_by_display_name: string | null;
        resources: Array<{
          type: ImageProxyResourceType;
          id: string;
          name: string;
        }>;
      }[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/admin/image-proxy?${p.toString()}`, undefined, getToken());
  },
  adminDeleteImageProxy: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/image-proxy/${id}`,
      undefined,
      getToken(),
    ),
  adminSweepImageProxy: () =>
    request<{ deleted: number }>(
      "POST",
      "/admin/sweep-image-proxy",
      {},
      getToken(),
    ),

  // ─── Search (command palette) ──────────────────────────────────────────────
  search: (q: string) =>
    request<{ results: SearchHit[] }>(
      "GET",
      `/search?q=${encodeURIComponent(q)}`,
      undefined,
      getToken(),
    ),

  // ─── Audit logs (Transparent Control) ─────────────────────────────────────
  // `base` is one of: "me", "team/<id>", "platform".
  auditEvents: (base: string, params: AuditQuery = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", String(params.from));
    if (params.to) qs.set("to", String(params.to));
    if (params.action) qs.set("action", params.action);
    if (params.actor_id) qs.set("actor_id", params.actor_id);
    if (params.resource_type) qs.set("resource_type", params.resource_type);
    if (params.resource_id) qs.set("resource_id", params.resource_id);
    if (params.page) qs.set("page", String(params.page));
    const q = qs.toString();
    return request<AuditEventsResponse>(
      "GET",
      `/audit/${base}/events${q ? `?${q}` : ""}`,
      undefined,
      getToken(),
    );
  },
  auditWebhooks: (base: string) =>
    request<{ webhooks: AuditWebhook[] }>(
      "GET",
      `/audit/${base}/webhooks`,
      undefined,
      getToken(),
    ),
  createAuditWebhook: (base: string, body: AuditWebhookInput) =>
    request<{ webhook: AuditWebhook }>(
      "POST",
      `/audit/${base}/webhooks`,
      body,
      getToken(),
    ),
  updateAuditWebhook: (base: string, id: string, body: AuditWebhookInput) =>
    request<{ webhook: AuditWebhook }>(
      "PATCH",
      `/audit/${base}/webhooks/${id}`,
      body,
      getToken(),
    ),
  deleteAuditWebhook: (base: string, id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/audit/${base}/webhooks/${id}`,
      undefined,
      getToken(),
    ),
  migrateLegacyWebhooks: () =>
    request<{ migrated: number; total: number }>(
      "POST",
      "/audit/platform/migrate-legacy-webhooks",
      {},
      getToken(),
    ),
  legacyWebhooksStatus: () =>
    request<{ total: number; unmigrated: number }>(
      "GET",
      "/audit/platform/legacy-webhooks-status",
      undefined,
      getToken(),
    ),

  // ─── Notification preferences ─────────────────────────────────────────────
  getNotificationPrefs: () =>
    request<{
      rules: NotificationRules;
      emails: NotifEmail[];
      tg_connections: NotifTgConnection[];
      discord_connections: NotifDiscordConnection[];
      available: string[];
    }>("GET", "/user/me/notifications", undefined, getToken()),
  updateNotificationPrefs: (rules: NotificationRules) =>
    request<{ rules: NotificationRules }>(
      "PUT",
      "/user/me/notifications",
      { rules },
      getToken(),
    ),
  listNotificationRulesets: () =>
    request<{ rulesets: NotificationRuleset[] }>(
      "GET",
      "/user/me/notification-rulesets",
      undefined,
      getToken(),
    ),
  createNotificationRuleset: (body: {
    name: string;
    rules: NotificationRulesetRule[];
    is_active?: boolean;
  }) =>
    request<{ ruleset: NotificationRuleset }>(
      "POST",
      "/user/me/notification-rulesets",
      body,
      getToken(),
    ),
  updateNotificationRuleset: (
    id: string,
    body: {
      name?: string;
      rules?: NotificationRulesetRule[];
      is_active?: boolean;
    },
  ) =>
    request<{ ruleset: NotificationRuleset }>(
      "PUT",
      `/user/me/notification-rulesets/${id}`,
      body,
      getToken(),
    ),
  deleteNotificationRuleset: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/user/me/notification-rulesets/${id}`,
      undefined,
      getToken(),
    ),

  // Teams
  listTeams: (params: { page?: number; limit?: number; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      teams: Team[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/teams${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
  createTeam: (body: {
    name: string;
    description?: string;
    avatar_url?: string;
    parent_team_id?: string | null;
    /** Site admins only — hand the new team straight to its intended owner. */
    owner_id?: string;
    owner_username?: string;
  }) => request<{ team: Team }>("POST", "/teams", body, getToken()),
  listSubTeams: (
    parentTeamId: string,
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      sub_teams: SubTeamListItem[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/teams/${encodeURIComponent(parentTeamId)}/sub-teams${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  createSubTeam: (
    parentTeamId: string,
    body: { name: string; description?: string; avatar_url?: string },
  ) =>
    request<{ team: Team }>(
      "POST",
      `/teams/${encodeURIComponent(parentTeamId)}/sub-teams`,
      body,
      getToken(),
    ),
  moveTeam: (id: string, newParentTeamId: string | null) =>
    request<{ team: Team }>(
      "PATCH",
      `/teams/${encodeURIComponent(id)}`,
      { parent_team_id: newParentTeamId },
      getToken(),
    ),
  getTeam: (id: string) =>
    request<{
      team: Team;
      /** First page only. Page through listTeamMembers for the rest. */
      members: TeamMember[];
      /** Total across the team, not the page. */
      member_count: number;
      member_page: { page: number; limit: number };
    }>("GET", `/teams/${id}`, undefined, getToken()),
  updateTeam: (
    id: string,
    body: {
      name?: string;
      description?: string;
      avatar_url?: string;
      parent_team_id?: string | null;
      profile_is_public?: boolean;
      profile_show_description?: boolean | null;
      profile_show_avatar?: boolean | null;
      profile_show_owner?: boolean | null;
      profile_show_member_count?: boolean | null;
      profile_show_apps?: boolean | null;
      profile_show_domains?: boolean | null;
      profile_show_members?: boolean | null;
      profile_show_sub_teams?: boolean | null;
      require_2fa?: boolean;
      require_verified_email?: boolean;
      /** Owner-only. */
      enable_groups?: boolean;
      /** Team management setting: may unrestricted accounts join via invite
       *  link? Direct adds by an admin are never subject to it. */
      allow_normal_user_join?: boolean;
      /** Owner/co-owner setting: limit member list visibility for regular members */
      restrict_member_list_for_members?: boolean;
      /** Owner-only. Only the keys present are overridden; drop a key to let
       *  it fall back to the site default. */
      role_permissions?: TeamRolePermissions;
    },
  ) => request<{ team: Team }>("PATCH", `/teams/${id}`, body, getToken()),
  listTeamGroups: (teamId: string) =>
    request<{
      enabled: boolean;
      /** Resolved through the full chain, including this team's overrides. */
      capabilities: Record<TeamCapability, boolean>;
      /** What the chain gives without this team's overrides — lets the
       *  settings UI say what "follow the site default" means. */
      default_capabilities: Record<TeamCapability, boolean>;
      can_manage: boolean;
      groups: TeamGroup[];
    }>(
      "GET",
      `/teams/${encodeURIComponent(teamId)}/groups`,
      undefined,
      getToken(),
    ),
  createTeamGroup: (
    teamId: string,
    body: {
      slug: string;
      name: string;
      description?: string;
      color?: string | null;
      admin_assignable?: boolean | null;
    },
  ) =>
    request<{ group: TeamGroup }>(
      "POST",
      `/teams/${encodeURIComponent(teamId)}/groups`,
      body,
      getToken(),
    ),
  updateTeamGroup: (
    teamId: string,
    groupId: string,
    body: {
      name?: string;
      description?: string;
      color?: string | null;
      admin_assignable?: boolean | null;
    },
  ) =>
    request<{ group: TeamGroup }>(
      "PATCH",
      `/teams/${encodeURIComponent(teamId)}/groups/${encodeURIComponent(groupId)}`,
      body,
      getToken(),
    ),
  deleteTeamGroup: (teamId: string, groupId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/teams/${encodeURIComponent(teamId)}/groups/${encodeURIComponent(groupId)}`,
      undefined,
      getToken(),
    ),
  setTeamMemberGroups: (teamId: string, userId: string, groupIds: string[]) =>
    request<{ groups: MemberGroup[] }>(
      "PUT",
      `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/groups`,
      { group_ids: groupIds },
      getToken(),
    ),
  setTeamShowOnProfile: (id: string, value: boolean | null) =>
    request<{ show_on_profile: boolean | null }>(
      "PATCH",
      `/teams/${encodeURIComponent(id)}/membership/show-on-profile`,
      { show_on_profile: value },
      getToken(),
    ),
  getPublicTeamProfile: (id: string) =>
    request<{ team: PublicTeamProfile }>(
      "GET",
      `/public/teams/${encodeURIComponent(id)}`,
      undefined,
      getToken(),
    ),
  deleteTeam: (id: string) =>
    request<{ ok: true }>("DELETE", `/teams/${id}`, undefined, getToken()),
  listTeamMembers: (
    teamId: string,
    params: {
      page?: number;
      limit?: number;
      q?: string;
      group?: string;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    if (params.group) search.set("group", params.group);
    const qs = search.toString();
    return request<{
      members: TeamMember[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/teams/${encodeURIComponent(teamId)}/members${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  addTeamMember: (
    teamId: string,
    body: { username?: string; user_id?: string; role?: string },
  ) =>
    request<{ ok: true }>("POST", `/teams/${teamId}/members`, body, getToken()),
  changeTeamMemberRole: (teamId: string, userId: string, role: string) =>
    request<{ ok: true }>(
      "PATCH",
      `/teams/${teamId}/members/${userId}`,
      { role },
      getToken(),
    ),
  removeTeamMember: (teamId: string, userId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/teams/${teamId}/members/${userId}`,
      undefined,
      getToken(),
    ),
  transferOwnership: (teamId: string, userId: string) =>
    request<{ ok: true }>(
      "POST",
      `/teams/${teamId}/transfer-ownership`,
      { user_id: userId },
      getToken(),
    ),
  listTeamApps: (
    teamId: string,
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      apps: OAuthApp[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/teams/${teamId}/apps${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  createTeamApp: (teamId: string, body: CreateAppBody) =>
    request<{ app: CreatedOAuthApp }>(
      "POST",
      `/teams/${teamId}/apps`,
      body,
      getToken(),
    ),
  transferAppToTeam: (teamId: string, appId: string) =>
    request<{ ok: true }>(
      "POST",
      `/teams/${teamId}/apps/transfer`,
      { app_id: appId },
      getToken(),
    ),
  removeAppFromTeam: (teamId: string, appId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/teams/${teamId}/apps/${appId}/transfer`,
      undefined,
      getToken(),
    ),

  // Team domains
  listTeamDomains: (
    teamId: string,
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      /** Ancestor teams' domains come along read-only, tagged with
       *  `inherited_from`. */
      domains: (Domain & { inherited_from?: string | null })[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/teams/${teamId}/domains${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  getTeamDomain: (teamId: string, domainId: string) =>
    request<{ domain: Domain }>(
      "GET",
      `/teams/${teamId}/domains/${domainId}`,
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
  verifyTeamDomain: (
    teamId: string,
    domainId: string,
    method?: VerificationMethod,
  ) =>
    request<DomainVerifyResponse>(
      "POST",
      `/teams/${teamId}/domains/${domainId}/verify`,
      method ? { method } : undefined,
      getToken(),
    ),
  deleteTeamDomain: (teamId: string, domainId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/teams/${teamId}/domains/${domainId}`,
      undefined,
      getToken(),
    ),
  transferDomainToTeam: (domainId: string, teamId: string) =>
    request<{ ok: true }>(
      "POST",
      `/domains/${domainId}/transfer`,
      { team_id: teamId },
      getToken(),
    ),
  returnDomainToPersonal: (teamId: string, domainId: string) =>
    request<{ ok: true }>(
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
  listTeamInvites: (
    teamId: string,
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      invites: TeamInvite[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/teams/${teamId}/invites${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  createTeamInvite: (
    teamId: string,
    body: {
      role?: string;
      email?: string;
      max_uses?: number;
      expires_at: number;
      group_ids?: string[];
      allow_existing_members?: boolean;
      /** Makes the link able to create accounts. Requires a finite max_uses
       *  and forces the granted role to `member`. */
      allows_registration?: boolean;
    },
  ) =>
    request<{ invite: TeamInvite }>(
      "POST",
      `/teams/${teamId}/invites`,
      body,
      getToken(),
    ),
  revokeTeamInvite: (teamId: string, token: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/teams/${teamId}/invites/${token}`,
      undefined,
      getToken(),
    ),
  updateTeamInvite: (
    teamId: string,
    token: string,
    body: {
      email?: string | null;
      max_uses?: number;
      expires_at?: number;
      enabled?: boolean;
    },
  ) =>
    request<{ invite: TeamInvite }>(
      "PATCH",
      `/teams/${teamId}/invites/${encodeURIComponent(token)}`,
      body,
      getToken(),
    ),
  getTeamInvite: (token: string) =>
    request<TeamInviteInfo>("GET", `/teams/join/${token}`),
  acceptTeamInvite: (token: string) =>
    request<{ ok: true }>(
      "POST",
      `/teams/join/${token}`,
      undefined,
      getToken(),
    ),

  // Admin teams
  adminListTeams: (
    page = 1,
    search = "",
    /** Only teams granted invite sign-up, or with a conversion override. */
    filter?: "invite_signup" | "convert",
  ) =>
    request<{ teams: AdminTeam[]; total: number }>(
      "GET",
      `/admin/teams?page=${page}&search=${encodeURIComponent(search)}${filter ? `&filter=${filter}` : ""}`,
      undefined,
      getToken(),
    ),
  adminDeleteTeam: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/teams/${id}`,
      undefined,
      getToken(),
    ),

  // ── Per-account admin control ─────────────────────────────────────────────
  // The `/me` surface, addressed by user id. Admin-only and audited into both
  // the platform log and the user's own.
  adminUserSecurity: (id: string) =>
    request<AdminUserSecurity>(
      "GET",
      `/admin/users/${id}/security`,
      undefined,
      getToken(),
    ),
  adminSetUserPassword: (
    id: string,
    password: string | null,
    opts: { revokeSessions?: boolean } = {},
  ) =>
    request<{ ok: true }>(
      "POST",
      `/admin/users/${id}/password`,
      { password, revoke_sessions: opts.revokeSessions ?? true },
      getToken(),
    ),
  adminReset2fa: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/2fa`,
      undefined,
      getToken(),
    ),
  adminDeleteUserTotp: (id: string, totpId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/totp/${totpId}`,
      undefined,
      getToken(),
    ),
  adminDeleteUserPasskey: (id: string, passkeyId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/passkeys/${passkeyId}`,
      undefined,
      getToken(),
    ),
  adminUserTokens: (id: string, page = 1) =>
    request<{
      tokens: AdminUserToken[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/admin/users/${id}/tokens?page=${page}`, undefined, getToken()),
  adminRevokeUserToken: (id: string, tokenId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/tokens/${tokenId}`,
      undefined,
      getToken(),
    ),
  adminUserConnections: (id: string) =>
    request<{ connections: AdminUserConnection[] }>(
      "GET",
      `/admin/users/${id}/connections`,
      undefined,
      getToken(),
    ),
  adminRemoveUserConnection: (id: string, connId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/connections/${connId}`,
      undefined,
      getToken(),
    ),
  adminUserGpgKeys: (id: string) =>
    request<{ keys: AdminUserGpgKey[] }>(
      "GET",
      `/admin/users/${id}/gpg-keys`,
      undefined,
      getToken(),
    ),
  adminRemoveUserGpgKey: (id: string, keyId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/gpg-keys/${keyId}`,
      undefined,
      getToken(),
    ),
  adminUserEmails: (id: string) =>
    request<AdminUserEmails>(
      "GET",
      `/admin/users/${id}/emails`,
      undefined,
      getToken(),
    ),
  /** `emailId` is "primary" for the address on the users row itself. */
  adminVerifyUserEmail: (id: string, emailId: string) =>
    request<{ ok: true }>(
      "POST",
      `/admin/users/${id}/emails/${emailId}/verify`,
      {},
      getToken(),
    ),
  adminSetPrimaryUserEmail: (id: string, emailId: string) =>
    request<{ ok: true }>(
      "POST",
      `/admin/users/${id}/emails/${emailId}/set-primary`,
      {},
      getToken(),
    ),
  adminRemoveUserEmail: (id: string, emailId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/emails/${emailId}`,
      undefined,
      getToken(),
    ),
  adminUserDomains: (id: string) =>
    request<{ domains: AdminUserDomain[] }>(
      "GET",
      `/admin/users/${id}/domains`,
      undefined,
      getToken(),
    ),
  adminRemoveUserDomain: (id: string, domainId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/domains/${domainId}`,
      undefined,
      getToken(),
    ),
  adminUserAuthorizations: (id: string) =>
    request<{ authorizations: AdminUserAuthorization[] }>(
      "GET",
      `/admin/users/${id}/authorizations`,
      undefined,
      getToken(),
    ),
  adminRevokeUserAuthorization: (id: string, consentId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/authorizations/${consentId}`,
      undefined,
      getToken(),
    ),
  adminUserTeams: (id: string) =>
    request<{ teams: AdminUserTeam[] }>(
      "GET",
      `/admin/users/${id}/teams`,
      undefined,
      getToken(),
    ),

  // ── Direct database access ────────────────────────────────────────────────
  // Every call here is admin-only and audited server-side.
  adminDbStatus: () =>
    request<{
      mode: "full" | "read-only" | "off";
      writable: boolean;
      /** Tables no setting lets the console write to — the audit log and the
       *  schema table that could be used to rename it. */
      append_only: string[];
    }>("GET", "/admin/db/status", undefined, getToken()),
  adminDbTables: () =>
    request<{ tables: DbTable[] }>(
      "GET",
      "/admin/db/tables",
      undefined,
      getToken(),
    ),
  adminDbRows: (
    table: string,
    params: {
      page?: number;
      limit?: number;
      order_by?: string;
      dir?: "asc" | "desc";
      where?: string;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.order_by) search.set("order_by", params.order_by);
    if (params.dir) search.set("dir", params.dir);
    if (params.where) search.set("where", params.where);
    const qs = search.toString();
    return request<DbRowPage>(
      "GET",
      `/admin/db/tables/${encodeURIComponent(table)}/rows${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  adminDbInsertRow: (table: string, values: Record<string, unknown>) =>
    request<{ ok: true }>(
      "POST",
      `/admin/db/tables/${encodeURIComponent(table)}/rows`,
      { values },
      getToken(),
    ),
  adminDbUpdateRow: (
    table: string,
    key: Record<string, unknown>,
    values: Record<string, unknown>,
  ) =>
    request<{ ok: true }>(
      "PATCH",
      `/admin/db/tables/${encodeURIComponent(table)}/rows`,
      { key, values },
      getToken(),
    ),
  adminDbDeleteRow: (table: string, key: Record<string, unknown>) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/db/tables/${encodeURIComponent(table)}/rows`,
      { key },
      getToken(),
    ),
  adminDbQuery: (sql: string, opts: { allowWrite?: boolean } = {}) =>
    request<{ results: DbQueryResult[]; duration_ms: number }>(
      "POST",
      "/admin/db/query",
      { sql, allow_write: opts.allowWrite ?? false },
      getToken(),
    ),

  // ── Key-value browser ─────────────────────────────────────────────────────
  adminKvStatus: () =>
    request<{
      mode: "full" | "read-only" | "off";
      writable: boolean;
      namespaces: Array<{ key: KvNamespaceKey }>;
    }>("GET", "/admin/kv/status", undefined, getToken()),
  adminKvKeys: (
    ns: string,
    params: { prefix?: string; cursor?: string; limit?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.prefix) search.set("prefix", params.prefix);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return request<KvKeyPage>(
      "GET",
      `/admin/kv/${ns}/keys${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  adminKvGet: (ns: string, key: string) =>
    request<KvEntry>(
      "GET",
      `/admin/kv/${ns}/keys/${encodeURIComponent(key)}`,
      undefined,
      getToken(),
    ),
  adminKvPut: (
    ns: string,
    key: string,
    value: string,
    expirationTtl?: number | null,
  ) =>
    request<{ ok: true }>(
      "PUT",
      `/admin/kv/${ns}/keys/${encodeURIComponent(key)}`,
      { value, expiration_ttl: expirationTtl ?? null },
      getToken(),
    ),
  adminKvDelete: (ns: string, key: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/kv/${ns}/keys/${encodeURIComponent(key)}`,
      undefined,
      getToken(),
    ),
  adminKvPurge: (ns: string, prefix: string) =>
    request<{
      deleted: number;
      skipped_protected: number;
      more: boolean;
    }>(
      "POST",
      `/admin/kv/${ns}/purge?prefix=${encodeURIComponent(prefix)}`,
      {},
      getToken(),
    ),

  // ── Instance-wide operations ──────────────────────────────────────────────
  adminRevokePreview: () =>
    request<{
      sessions: number;
      oauth_tokens: number;
      oauth_consents: number;
      personal_access_tokens: number;
    }>("GET", "/admin/revoke/preview", undefined, getToken()),
  adminRevokeAllSessions: (includeSelf = false) =>
    request<{ deleted: number; your_session_kept: boolean }>(
      "POST",
      "/admin/revoke/sessions",
      { include_self: includeSelf },
      getToken(),
    ),
  adminRevokeApp: (appId: string, deactivate = false) =>
    request<{
      tokens_revoked: number;
      consents_revoked: number;
      deactivated: boolean;
    }>("POST", `/admin/revoke/app/${appId}`, { deactivate }, getToken()),
  adminRevokeUserGrants: (userId: string) =>
    request<{
      tokens_revoked: number;
      consents_revoked: number;
    }>("POST", `/admin/revoke/user/${userId}/grants`, {}, getToken()),
  adminListDomains: (
    params: {
      page?: number;
      limit?: number;
      q?: string;
      verified?: "0" | "1";
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    if (params.verified) search.set("verified", params.verified);
    const qs = search.toString();
    return request<{
      domains: AdminDomain[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/admin/domains${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
  adminSetDomainVerified: (id: string, verified: boolean) =>
    request<{ ok: true }>(
      "POST",
      `/admin/domains/${id}/verify`,
      { verified },
      getToken(),
    ),
  adminDeleteDomain: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/domains/${id}`,
      undefined,
      getToken(),
    ),
  adminTransferApp: (
    appId: string,
    target: { owner_id?: string; team_id?: string },
  ) =>
    request<{ ok: true }>(
      "POST",
      `/admin/apps/${appId}/transfer`,
      target,
      getToken(),
    ),
  /** Download the audit log for any scope the caller can read.
   *
   *  Saves the file the way adminExportRequestLogs does, and uses the
   *  filename the server chose — it already knows the scope and the date. */
  auditExport: async (
    base: string,
    format: "csv" | "json",
    params: AuditQuery = {},
  ): Promise<void> => {
    const qs = new URLSearchParams({ format });
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== "") qs.set(k, String(v));
    const res = await fetch(`${BASE}/audit/${base}/export?${qs}`, {
      credentials: "include",
    });
    if (!res.ok) throw new ApiError(res.status, "Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      /filename="([^"]+)"/.exec(
        res.headers.get("Content-Disposition") ?? "",
      )?.[1] ?? `audit.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
  adminTeamInvites: (
    params: {
      page?: number;
      limit?: number;
      q?: string;
      registration?: boolean;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    if (params.registration) search.set("registration", "1");
    const qs = search.toString();
    return request<{
      invites: AdminTeamInvite[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/admin/team-invites${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
  adminRevokeTeamInvite: (token: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/team-invites/${encodeURIComponent(token)}`,
      undefined,
      getToken(),
    ),
  adminBulkUsers: (
    userIds: string[],
    action: "deactivate" | "activate" | "delete",
  ) =>
    request<{
      action: string;
      affected: number;
      skipped: Array<{ id: string; username: string; reason: string }>;
    }>("POST", "/admin/users/bulk", { user_ids: userIds, action }, getToken()),
  adminUserNotifications: (id: string) =>
    request<{
      rulesets: Array<{
        id: string;
        name: string;
        is_active: boolean;
        rule_count: number;
      }>;
      legacy_pref_count: number;
    }>("GET", `/admin/users/${id}/notifications`, undefined, getToken()),
  adminResetUserNotifications: (id: string) =>
    request<{ removed: number }>(
      "DELETE",
      `/admin/users/${id}/notification-rulesets`,
      undefined,
      getToken(),
    ),
  // ── Notice board ──────────────────────────────────────────────────────────
  /** Notices for the current viewer. Works signed out — public notices are
   *  the case a maintenance announcement most needs to reach. */
  notices: () =>
    request<{ notices: Notice[] }>("GET", "/notices", undefined, getToken()),
  dismissNotice: (id: string) =>
    request<{ ok: true }>("POST", `/notices/${id}/dismiss`, {}, getToken()),
  adminListNotices: (page = 1, q = "") =>
    request<{
      notices: AdminNotice[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/admin/notices?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      undefined,
      getToken(),
    ),
  adminGetNotice: (id: string) =>
    request<{ notice: AdminNotice }>(
      "GET",
      `/admin/notices/${id}`,
      undefined,
      getToken(),
    ),
  adminCreateNotice: (body: NoticeInput) =>
    request<{ notice: AdminNotice }>(
      "POST",
      "/admin/notices",
      body,
      getToken(),
    ),
  adminUpdateNotice: (
    id: string,
    body: Partial<NoticeInput> & { reset_dismissals?: boolean },
  ) =>
    request<{ notice: AdminNotice; dismissals_reset: number }>(
      "PATCH",
      `/admin/notices/${id}`,
      body,
      getToken(),
    ),
  adminDeleteNotice: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/notices/${id}`,
      undefined,
      getToken(),
    ),

  adminScopeGrants: (
    kind: ScopeGrantKind,
    page = 1,
    opts: { q?: string; teamId?: string } = {},
  ) => {
    const search = new URLSearchParams({ page: String(page) });
    if (opts.q) search.set("q", opts.q);
    if (opts.teamId) search.set("team_id", opts.teamId);
    return request<{
      grants: AdminScopeGrant[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/admin/scope-grants/${kind}?${search.toString()}`,
      undefined,
      getToken(),
    );
  },
  adminGetScopeGrant: (kind: ScopeGrantKind, id: string) =>
    request<{ grant: AdminScopeGrantDetail }>(
      "GET",
      `/admin/scope-grants/${kind}/${id}`,
      undefined,
      getToken(),
    ),
  /** Takes the grant out of the app's approvals and deletes the tokens
   *  that carry it. */
  adminRevokeScopeGrant: (kind: ScopeGrantKind, id: string) =>
    request<{ approvals: number; tokens: number }>(
      "DELETE",
      `/admin/scope-grants/${kind}/${id}`,
      undefined,
      getToken(),
    ),
  /** End every session for one account. */
  adminTerminateSessions: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/sessions`,
      undefined,
      getToken(),
    ),
  adminUserSessions: (id: string) =>
    request<{ sessions: AdminSession[] }>(
      "GET",
      `/admin/users/${id}/sessions`,
      undefined,
      getToken(),
    ),
  adminRevokeSession: (id: string, sessionId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/users/${id}/sessions/${sessionId}`,
      undefined,
      getToken(),
    ),
  adminMaintenanceJobs: () =>
    request<{
      jobs: Array<{ key: MaintenanceJobKey; writes: boolean }>;
      schedule: string;
    }>("GET", "/admin/maintenance/jobs", undefined, getToken()),
  adminRunMaintenanceJob: (key: string) =>
    request<{
      job: string;
      /** null when the task keeps no count — not the same as zero. */
      processed: number | null;
      duration_ms: number;
    }>("POST", `/admin/maintenance/jobs/${key}/run`, {}, getToken()),
  adminConvertUser: (id: string, requireVerifiedEmail = true) =>
    request<{ ok: true }>(
      "POST",
      `/admin/users/${id}/convert`,
      { require_verified_email: requireVerifiedEmail },
      getToken(),
    ),

  // Site invites
  adminListInvites: (
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      invites: SiteInvite[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/admin/invites${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
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
  adminGetInvite: (id: string) =>
    request<{ invite: SiteInvite }>(
      "GET",
      `/admin/invites/${encodeURIComponent(id)}`,
      undefined,
      getToken(),
    ),
  adminUpdateInvite: (
    id: string,
    body: {
      email?: string | null;
      note?: string | null;
      max_uses?: number | null;
      expires_in_days?: number | null;
      enabled?: boolean;
    },
  ) =>
    request<{ invite: SiteInvite }>(
      "PATCH",
      `/admin/invites/${id}`,
      body,
      getToken(),
    ),
  adminRevokeInvite: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/invites/${id}`,
      undefined,
      getToken(),
    ),

  // OAuth sources
  adminListOAuthSources: (
    params: { page?: number; limit?: number; q?: string } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      sources: OAuthSource[];
      legacy_providers: string[];
      total: number;
      page: number;
      limit: number;
    }>(
      "GET",
      `/admin/oauth-sources${qs ? `?${qs}` : ""}`,
      undefined,
      getToken(),
    );
  },
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
  adminGetOAuthSource: (id: string) =>
    request<{ source: OAuthSource }>(
      "GET",
      `/admin/oauth-sources/${id}`,
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
    icon_url?: string;
    show_icon?: boolean;
    icon_only?: 0 | 1 | 2;
    trusted?: boolean;
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
      icon_url?: string;
      show_icon?: boolean;
      icon_only?: 0 | 1 | 2;
      trusted?: boolean;
    },
  ) =>
    request<{ ok: true }>(
      "PATCH",
      `/admin/oauth-sources/${id}`,
      body,
      getToken(),
    ),
  adminDeleteOAuthSource: (id: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/oauth-sources/${id}`,
      undefined,
      getToken(),
    ),

  // ─── Personal Access Tokens ───────────────────────────────────────────────
  listTokens: (params: { page?: number; limit?: number; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      tokens: {
        id: string;
        name: string;
        scopes: string[];
        expires_at: number | null;
        last_used_at: number | null;
        created_at: number;
      }[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/user/tokens${qs ? `?${qs}` : ""}`, undefined, getToken());
  },
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
    request<{ ok: true }>(
      "DELETE",
      `/user/tokens/${id}`,
      undefined,
      getToken(),
    ),
});

/**
 * Build an API client whose transport and credential access belong to one
 * runtime. The browser exports one long-lived client below; every SSR render
 * creates its own instance so concurrent requests can never exchange cookies,
 * tokens, or response data.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const request: ApiRequest = (method, path, body, token) =>
    performRequest(options, method, path, body, token);
  const getToken = options.getToken ?? (() => undefined);
  return buildApi(request, getToken);
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Browser API client. SSR must use createApiClient with request-local options. */
export const api = createApiClient({
  isNormalView,
  onInvalidSession: () => authStore.getState().clearAuth(),
  translate: i18nErrorTranslator(clientI18n),
});
