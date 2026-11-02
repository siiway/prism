// Fixed value sets the Worker sends and the frontend turns into translation
// keys. Each is one `as const` list here, so the Worker can only send a value
// on the list and the client's types know every value it can receive.
// scripts/check-translations.ts reads these types to work out exactly which
// keys are used and to fail when one has no translation.

/** Why a sign-in attempt failed, as logged in login_errors.error_code. */
export const LOGIN_ERROR_CODES = [
  "invalid_credentials",
  "totp_invalid",
  "account_disabled",
  "rate_limited",
  "captcha_failed",
  "gpg_no_keys",
  "gpg_invalid_signature",
  "gpg_challenge_mismatch",
] as const;
export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

/** Codes older builds wrote that may still be in the table. */
export const LEGACY_LOGIN_ERROR_CODES = ["gpg_invaild_signature"] as const;
export type StoredLoginErrorCode =
  LoginErrorCode | (typeof LEGACY_LOGIN_ERROR_CODES)[number];

/** Maintenance jobs an admin can run by hand. */
export const MAINTENANCE_JOB_KEYS = [
  "reverify-domains",
  "imap-poll",
  "sweep-sessions",
  "sweep-pow",
  "purge-app-events",
  "sweep-image-proxy",
  "reap-pending-registrations",
  "reap-dissolved-teams",
] as const;
export type MaintenanceJobKey = (typeof MAINTENANCE_JOB_KEYS)[number];

/** What can point at a proxied image. */
export type ImageProxyResourceType = "user" | "team" | "app" | "oauth_source";

/** KV namespaces the admin KV browser can open. */
export type KvNamespaceKey = "sessions" | "cache";
