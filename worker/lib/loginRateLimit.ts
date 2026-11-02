import type { SiteConfig } from "../../shared/types";
import { randomId, sha256Hex } from "./crypto";
import {
  normalizeIp,
  rateLimit,
  rateLimitAll,
  rateLimitIp,
} from "../middleware/rateLimit";
import type { CodedError } from "./apiError";

export type LoginRateLimitConfig = Pick<
  SiteConfig,
  | "ipv6_rate_limit_prefix"
  | "login_dos_rate_limit"
  | "login_dos_rate_window_seconds"
  | "login_ip_rate_limit"
  | "login_ip_rate_window_seconds"
  | "login_identifier_rate_limit"
  | "login_identifier_rate_window_seconds"
  | "login_totp_rate_limit"
  | "login_totp_rate_window_seconds"
>;

export const LOGIN_RATE_LIMIT_CONFIG_KEYS = [
  "login_dos_rate_limit",
  "login_dos_rate_window_seconds",
  "login_ip_rate_limit",
  "login_ip_rate_window_seconds",
  "login_identifier_rate_limit",
  "login_identifier_rate_window_seconds",
  "login_totp_rate_limit",
  "login_totp_rate_window_seconds",
] as const;

export function invalidLoginRateLimitConfig(
  updates: Record<string, unknown>,
): CodedError | null {
  for (const key of LOGIN_RATE_LIMIT_CONFIG_KEYS) {
    const value = updates[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 86400
    ) {
      return {
        error: "field_int_range",
        params: { field: key, min: 1, max: 86400 },
      };
    }
  }
  return null;
}

export async function checkLoginRequestLimit(
  db: D1Database,
  ip: string,
  config: LoginRateLimitConfig,
) {
  return rateLimitIp(
    db,
    ip,
    "login-dos",
    config.login_dos_rate_limit,
    config.login_dos_rate_window_seconds,
    config.ipv6_rate_limit_prefix,
  );
}

export async function checkLoginCredentialLimits(
  db: D1Database,
  ip: string,
  identifier: string,
  config: LoginRateLimitConfig,
) {
  const identifierKey = `login-id:${await sha256Hex(identifier)}`;
  const allowed = await rateLimitAll(db, [
    {
      key: `login:${normalizeIp(ip, config.ipv6_rate_limit_prefix)}`,
      limit: config.login_ip_rate_limit,
      windowSeconds: config.login_ip_rate_window_seconds,
    },
    {
      key: identifierKey,
      limit: config.login_identifier_rate_limit,
      windowSeconds: config.login_identifier_rate_window_seconds,
    },
  ]);
  return { allowed, scope: allowed ? null : ("combined" as const) };
}

export async function checkLoginTotpLimit(
  db: D1Database,
  userId: string,
  config: LoginRateLimitConfig,
) {
  return rateLimit(
    db,
    `login-totp:${userId}`,
    config.login_totp_rate_limit,
    config.login_totp_rate_window_seconds,
  );
}

/** Record a failed sign-in attempt in the admin login-error log. */
export async function logLoginError(
  db: D1Database,
  errorCode: string,
  identifier: string | null,
  ip: string,
  userAgent: string | null,
  geo: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO login_errors (id, error_code, identifier, ip_address, user_agent, ip_geo, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      randomId(),
      errorCode,
      identifier,
      ip,
      userAgent,
      geo,
      JSON.stringify(metadata),
      now,
    )
    .run();
}
