import type { SiteConfig } from "../../shared/types";
import { sha256Hex } from "./crypto";
import { rateLimit, rateLimitIp } from "../middleware/rateLimit";

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
): string | null {
  for (const key of LOGIN_RATE_LIMIT_CONFIG_KEYS) {
    const value = updates[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 86400
    ) {
      return `${key} must be an integer between 1 and 86400`;
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
  const ipResult = await rateLimitIp(
    db,
    ip,
    "login",
    config.login_ip_rate_limit,
    config.login_ip_rate_window_seconds,
    config.ipv6_rate_limit_prefix,
  );
  if (!ipResult.allowed) return { allowed: false, scope: "ip" as const };

  const identifierResult = await rateLimit(
    db,
    `login-id:${await sha256Hex(identifier)}`,
    config.login_identifier_rate_limit,
    config.login_identifier_rate_window_seconds,
  );
  return {
    allowed: identifierResult.allowed,
    scope: identifierResult.allowed ? null : ("identifier" as const),
  };
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
