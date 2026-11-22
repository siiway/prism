// Site config updates: which keys an admin may set, and the checks every
// update goes through before it is stored. Shared by the admin dashboard
// (PATCH /api/admin/config) and the admin:config:write API
// (PATCH /api/oauth/me/admin/config), so neither can store what the other
// would refuse.

import type { CodedError } from "./apiError";
import { encryptConfigUpdates, setConfigValues } from "./config";
import { validateImageUrl } from "./imageValidation";
import { invalidLoginRateLimitConfig } from "./loginRateLimit";
import { sanitizeRolePermissions } from "./teamGroups";
import { sanitizeRestrictedCapabilities } from "./userCapabilities";

/** Every key an admin may set. */
export const ADMIN_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "site_name",
  "site_description",
  "site_icon_url",
  "allow_registration",
  "invite_only",
  "require_email_verification",
  "captcha_provider",
  "captcha_providers",
  "captcha_site_key",
  "captcha_secret_key",
  "turnstile_site_key",
  "turnstile_secret_key",
  "hcaptcha_site_key",
  "hcaptcha_secret_key",
  "recaptcha_site_key",
  "recaptcha_secret_key",
  "geetest_captcha_id",
  "geetest_captcha_key",
  "geetest_fail_open",
  "cap_mode",
  "cap_api_endpoint",
  "cap_site_key",
  "cap_secret_key",
  "cap_challenge_count",
  "cap_challenge_difficulty",
  "cap_instrumentation",
  "captcha_switch_timeout_seconds",
  "turnstile_endpoint_mode",
  "turnstile_china_site_key",
  "turnstile_china_secret_key",
  "domain_reverify_days",
  "session_ttl_days",
  "access_token_ttl_minutes",
  "refresh_token_ttl_days",
  "github_client_id",
  "github_client_secret",
  "google_client_id",
  "google_client_secret",
  "microsoft_client_id",
  "microsoft_client_secret",
  "discord_client_id",
  "discord_client_secret",
  "discord_bot_token",
  "email_provider",
  "email_verify_methods",
  "email_receive_host",
  "email_receive_provider",
  "imap_host",
  "imap_port",
  "imap_secure",
  "imap_user",
  "imap_password",
  "tg_notify_source_slug",
  "discord_notify_source_slug",
  "email_api_key",
  "email_from",
  "smtp_host",
  "smtp_port",
  "smtp_secure",
  "smtp_user",
  "smtp_password",
  "custom_css",
  "accent_color",
  "avatar_proxy_max_source_bytes",
  "avatar_proxy_cache_mode",
  "avatar_proxy_cache_ttl_seconds",
  "avatar_proxy_max_cache_bytes",
  "avatar_proxy_convert_to_webp",
  "security_contact",
  "security_policy_url",
  "login_error_retention_days",
  "social_verify_ttl_days",
  "allow_alt_email_login",
  "login_dos_rate_limit",
  "login_dos_rate_window_seconds",
  "login_ip_rate_limit",
  "login_ip_rate_window_seconds",
  "login_identifier_rate_limit",
  "login_identifier_rate_window_seconds",
  "login_totp_rate_limit",
  "login_totp_rate_window_seconds",
  "ipv6_rate_limit_prefix",
  "gpg_challenge_prefix",
  "disable_user_create_team",
  "disable_user_create_app",
  "saml_enabled",
  "silent_logout_first_party_only",
  "disable_ssr",
  "sudo_mode_ttl_minutes",
  "require_captcha_for_2fa",
  "enable_public_profiles",
  "show_powered_by",
  "default_profile_show_display_name",
  "default_profile_show_avatar",
  "default_profile_show_email",
  "default_profile_show_joined_at",
  "default_profile_show_gpg_keys",
  "default_profile_show_authorized_apps",
  "default_profile_show_owned_apps",
  "default_profile_show_domains",
  "default_profile_show_joined_teams",
  "default_profile_show_readme",
  "profile_readme_max_bytes",
  "github_readme_token",
  "github_readme_cache_ttl_seconds",
  "default_team_profile_show_description",
  "default_team_profile_show_avatar",
  "default_team_profile_show_owner",
  "default_team_profile_show_member_count",
  "default_team_profile_show_apps",
  "default_team_profile_show_domains",
  "default_team_profile_show_members",
  "default_team_require_2fa",
  "default_team_require_verified_email",
  "enable_sub_teams",
  "max_team_depth",
  "inherit_team_membership",
  "inherit_team_domains",
  "default_team_profile_show_sub_teams",
  "default_team_role_permissions",
  "team_invite_registration_max_uses_cap",
  "team_invite_registration_rate_per_hour",
  "restricted_user_capabilities",
  "restricted_pending_ttl_hours",
  "restricted_dissolve_grace_hours",
]);

/** Keep the allowed keys of a request body, validate them, and normalise
 *  what needs it. `refused` is the API error to answer with (status 400)
 *  when a value is not accepted. */
export async function prepareConfigUpdates(
  body: Record<string, unknown>,
  allowed: (key: string) => boolean,
): Promise<{ updates: Record<string, unknown> } | { refused: CodedError }> {
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed(k)) updates[k] = v;
  }

  if (
    updates.avatar_proxy_cache_mode !== undefined &&
    !["off", "kv", "d1"].includes(String(updates.avatar_proxy_cache_mode))
  ) {
    return {
      refused: {
        error: "field_invalid",
        params: { field: "avatar_proxy_cache" },
      },
    };
  }
  for (const key of [
    "avatar_proxy_max_source_bytes",
    "avatar_proxy_cache_ttl_seconds",
    "avatar_proxy_max_cache_bytes",
  ]) {
    const value = updates[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    )
      return {
        refused: {
          error: "field_must_be_positive_integer",
          params: { field: key },
        },
      };
  }
  if (
    updates.avatar_proxy_convert_to_webp !== undefined &&
    typeof updates.avatar_proxy_convert_to_webp !== "boolean"
  )
    return {
      refused: {
        error: "field_must_be_boolean",
        params: { field: "avatar_proxy_convert_to_webp" },
      },
    };

  if (updates.site_icon_url && typeof updates.site_icon_url === "string") {
    const imgErr = await validateImageUrl(updates.site_icon_url);
    if (imgErr) return { refused: imgErr };
  }

  if (updates.profile_readme_max_bytes !== undefined) {
    const v = updates.profile_readme_max_bytes;
    if (
      typeof v !== "number" ||
      !Number.isInteger(v) ||
      v < 1024 ||
      v > 1024 * 1024
    ) {
      return {
        refused: {
          error: "field_int_range",
          params: {
            field: "profile_readme_max_bytes",
            min: 1024,
            max: 1048576,
          },
        },
      };
    }
  }

  if (updates.github_readme_cache_ttl_seconds !== undefined) {
    const v = updates.github_readme_cache_ttl_seconds;
    // Anything under 60s would hammer the GitHub API; anything over a week
    // means stale READMEs sit forever after a manual sync. Pin the range.
    if (
      typeof v !== "number" ||
      !Number.isInteger(v) ||
      v < 60 ||
      v > 7 * 86400
    ) {
      return {
        refused: {
          error: "field_int_range",
          params: {
            field: "github_readme_cache_ttl_seconds",
            min: 60,
            max: 604800,
          },
        },
      };
    }
  }

  const loginRateLimitError = invalidLoginRateLimitConfig(updates);
  if (loginRateLimitError) return { refused: loginRateLimitError };

  // Rotating the site GitHub token always resets its failure counter so a
  // fresh paste isn't immediately auto-cleared by leftover bad-credential
  // counts from the previous token.
  if (updates.github_readme_token !== undefined) {
    updates.github_readme_token_failures = 0;
  }

  // Strip the site-default capability set down to keys we recognise so the
  // config row can't accumulate arbitrary JSON from a hand-rolled request.
  if (updates.default_team_role_permissions !== undefined) {
    updates.default_team_role_permissions = sanitizeRolePermissions(
      updates.default_team_role_permissions,
    );
  }

  if (updates.restricted_user_capabilities !== undefined) {
    updates.restricted_user_capabilities = sanitizeRestrictedCapabilities(
      updates.restricted_user_capabilities,
    );
  }

  // Bound sub-team nesting. Anything beyond ~20 is almost certainly a
  // configuration mistake (and the recursive helpers walk N rows per check).
  if (updates.max_team_depth !== undefined) {
    const v = updates.max_team_depth;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 20) {
      return {
        refused: {
          error: "field_int_range",
          params: { field: "max_team_depth", min: 1, max: 20 },
        },
      };
    }
  }

  return { updates };
}

/** Store prepared updates, encrypting the secret keys when SECRETS_KEY is
 *  bound (a no-op otherwise, so plaintext storage keeps working). */
export async function saveConfigUpdates(
  env: Env,
  updates: Record<string, unknown>,
): Promise<void> {
  await setConfigValues(env.DB, await encryptConfigUpdates(env, updates));
}
