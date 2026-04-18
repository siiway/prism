// Request / response logger middleware
// Disabled by default — enable via KV key "system:request_logging_enabled" = "true"
// Spectate mode   — set KV key "system:spectate_user_id" to a user ID for full body logging
// Force log all   — set KV key "system:force_log_all" = "true" to capture bodies for every request
// Except pattern  — set KV key "system:log_except_pattern" to skip logging for matching paths
// IP filter       — set KV key "system:log_ip" to restrict full-detail logging to one IP

import type { MiddlewareHandler } from "hono";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

// ─── Sensitive field redaction ────────────────────────────────────────────────

const REDACTED_FIELDS = new Set([
  "password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "code",
  "code_verifier",
  "authorization",
  "x-session-token",
  "cookie",
  "set-cookie",
  "email_api_key",
  "imap_password",
  "smtp_password",
  "captcha_secret_key",
  "recovery_code",
  "totp_secret",
]);

const REDACTED = "[REDACTED]";

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACTED_FIELDS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = REDACTED_FIELDS.has(k.toLowerCase()) ? REDACTED : v;
  });
  return out;
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text) return undefined;
  if (contentType?.includes("application/json")) {
    try {
      return redactObject(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return text.slice(0, 512);
    }
  }
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    const obj: Record<string, string> = {};
    params.forEach((v, k) => {
      obj[k] = REDACTED_FIELDS.has(k.toLowerCase()) ? REDACTED : v;
    });
    return obj;
  }
  return text.slice(0, 512);
}

function parseResBody(text: string, contentType: string | null): unknown {
  if (!text) return undefined;
  if (contentType?.includes("application/json")) {
    try {
      return redactObject(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return text.slice(0, 2048);
    }
  }
  return text.slice(0, 2048);
}

// ─── Module-level KV flag cache (avoids a KV read on every request) ───────────

const FLAG_TTL_MS = 10_000; // re-check KV every 10 seconds

let cachedLoggingEnabled: boolean = false;
let cachedForceLogAll: boolean = false;
let cachedSpectateUserId: string | null = null;
let cachedSpectatePathPattern: string | null = null;
let cachedExceptPattern: string | null = null;
let cachedLogIp: string | null = null;
let cacheExpiry: number = 0;

async function getFlags(kv: KVNamespace): Promise<{
  loggingEnabled: boolean;
  forceLogAll: boolean;
  spectateUserId: string | null;
  spectatePathPattern: string | null;
  exceptPattern: string | null;
  logIp: string | null;
}> {
  const now = Date.now();
  if (now < cacheExpiry) {
    return {
      loggingEnabled: cachedLoggingEnabled,
      forceLogAll: cachedForceLogAll,
      spectateUserId: cachedSpectateUserId,
      spectatePathPattern: cachedSpectatePathPattern,
      exceptPattern: cachedExceptPattern,
      logIp: cachedLogIp,
    };
  }
  const [enabled, forceAll, spectate, spectatePath, except_, logIp] =
    await Promise.all([
      kv.get("system:request_logging_enabled"),
      kv.get("system:force_log_all"),
      kv.get("system:spectate_user_id"),
      kv.get("system:spectate_path"),
      kv.get("system:log_except_pattern"),
      kv.get("system:log_ip"),
    ]);
  cachedLoggingEnabled = enabled === "true";
  cachedForceLogAll = forceAll === "true";
  cachedSpectateUserId = spectate ?? null;
  cachedSpectatePathPattern = spectatePath ?? null;
  cachedExceptPattern = except_ ?? null;
  cachedLogIp = logIp ?? null;
  cacheExpiry = now + FLAG_TTL_MS;
  return {
    loggingEnabled: cachedLoggingEnabled,
    forceLogAll: cachedForceLogAll,
    spectateUserId: cachedSpectateUserId,
    spectatePathPattern: cachedSpectatePathPattern,
    exceptPattern: cachedExceptPattern,
    logIp: cachedLogIp,
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();

  const reqContentType = c.req.raw.headers.get("content-type");
  const reqBodyText = await c.req.raw
    .clone()
    .text()
    .catch(() => "");

  await next();

  const durationMs = Date.now() - start;
  const { method, url } = c.req.raw;
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname;
  const status = c.res.status;
  const ip =
    c.req.raw.headers.get("cf-connecting-ip") ??
    c.req.raw.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    null;
  const userAgent = c.req.raw.headers.get("user-agent") ?? null;
  const userId = (c.get("user") as { id?: string } | undefined)?.id ?? null;

  // Always log to console
  console.log(
    JSON.stringify({
      type: "request",
      method,
      path,
      status,
      duration_ms: durationMs,
      ip,
      user_id: userId,
    }),
  );

  const {
    loggingEnabled,
    forceLogAll,
    spectateUserId,
    spectatePathPattern,
    exceptPattern,
    logIp,
  } = await getFlags(c.env.KV_SESSIONS);

  if (!loggingEnabled) return;

  // Skip logging for excluded paths
  if (exceptPattern && path.includes(exceptPattern)) return;

  // IP filter: when set, only log requests from that IP
  if (logIp && ip !== logIp) return;

  const isSpectatingUser = spectateUserId !== null && userId === spectateUserId;
  const isSpectatingPath =
    spectatePathPattern !== null && path.includes(spectatePathPattern);
  const isSpectating = isSpectatingUser || isSpectatingPath;

  const captureDetails = forceLogAll || isSpectating;

  let details: string | null = null;
  if (captureDetails) {
    const resContentType = c.res.headers.get("content-type");
    const resBodyText = await c.res
      .clone()
      .text()
      .catch(() => "");
    details = JSON.stringify({
      req: {
        headers: redactHeaders(c.req.raw.headers),
        query: Object.fromEntries(parsedUrl.searchParams),
        body: parseBody(reqBodyText, reqContentType),
      },
      res: {
        headers: redactHeaders(c.res.headers),
        body: parseResBody(resBodyText, resContentType),
      },
    });
  }

  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);

  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      "INSERT INTO request_logs (id, method, path, status, duration_ms, ip_address, user_agent, user_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        method,
        path,
        status,
        durationMs,
        ip,
        userAgent,
        userId,
        details,
        createdAt,
      )
      .run()
      .catch(() => {}),
  );
};
