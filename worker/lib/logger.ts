// Request / response logger middleware
// Disabled by default — enable via KV key "system:request_logging_enabled" = "true"
// Spectate mode   — set KV key "system:spectate_user_id" to a user ID for full body logging
// Force log all   — set KV key "system:force_log_all" = "true" to capture bodies for every request
// Except pattern  — set KV key "system:log_except_pattern" to skip logging for matching paths
// IP filter       — set KV key "system:log_ip" to restrict full-detail logging to one IP

import type { MiddlewareHandler } from "hono";
import type { Variables } from "../types";
import { geoJson } from "./geo";
import { safeFetch } from "./safeFetch";

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
  "registration_access_token",
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
  "secret",
  "nonce",
  "backup_codes",
  "backup_code",
  "verify_code",
  "verify_token",
  "email_verify_code",
  "email_verify_token",
  "invite_token",
  "invite",
  // otpauth:// URI — carries the TOTP seed in its query string, so it is as
  // sensitive as `secret` itself.
  "uri",
  // Opaque handles that complete a pending social login / 2FA step. They
  // arrive as query parameters, which is exactly the position that used to
  // skip redaction entirely.
  "key",
  "state",
  "github_readme_token",
  "github_client_secret",
  "google_client_secret",
  "microsoft_client_secret",
  "discord_client_secret",
  "discord_bot_token",
]);

const REDACTED = "[REDACTED]";
const REDACTED_UNSTRUCTURED_BODY = "[REDACTED UNSTRUCTURED BODY]";
const MAX_REDACTION_DEPTH = 32;
const NORMALIZED_REDACTED_FIELDS = new Set(
  [...REDACTED_FIELDS].map((key) => key.replace(/[^a-z0-9]/g, "")),
);

function isRedactedField(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    REDACTED_FIELDS.has(lower) ||
    NORMALIZED_REDACTED_FIELDS.has(lower.replace(/[^a-z0-9]/g, ""))
  );
}

/** Recursively redact JSON-compatible values before they enter request logs.
 *  A depth limit makes logging fail closed for pathologically nested input
 *  instead of returning an uninspected subtree. */
export function redactForLogging(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    if (depth >= MAX_REDACTION_DEPTH) return REDACTED;
    return value.map((entry) => redactForLogging(entry, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_REDACTION_DEPTH) return REDACTED;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isRedactedField(key) ? REDACTED : redactForLogging(entry, depth + 1),
      ]),
    );
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  return redactForLogging(obj) as Record<string, unknown>;
}

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = isRedactedField(k) ? REDACTED : v;
  });
  return out;
}

export function redactUrlForLogging(url: string): string {
  let out = url;
  try {
    const parsed = new URL(url);
    for (const key of new Set(parsed.searchParams.keys())) {
      if (isRedactedField(key)) parsed.searchParams.set(key, REDACTED);
    }
    out = parsed.toString();
  } catch {
    // Relative/malformed URLs still receive the path-specific redaction below.
  }
  return out.replace(/\/bot[^/]+\/sendMessage/g, `/bot${REDACTED}/sendMessage`);
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text) return undefined;
  if (contentType?.includes("application/json")) {
    try {
      return redactForLogging(JSON.parse(text));
    } catch {
      return REDACTED_UNSTRUCTURED_BODY;
    }
  }
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    const obj: Record<string, string> = {};
    params.forEach((v, k) => {
      obj[k] = isRedactedField(k) ? REDACTED : v;
    });
    return obj;
  }
  return REDACTED_UNSTRUCTURED_BODY;
}

function parseResBody(text: string, contentType: string | null): unknown {
  if (!text) return undefined;
  if (contentType?.includes("application/json")) {
    try {
      return redactForLogging(JSON.parse(text));
    } catch {
      return REDACTED_UNSTRUCTURED_BODY;
    }
  }
  return REDACTED_UNSTRUCTURED_BODY;
}

function methodFromRequest(req: Request): string {
  return req.method.toUpperCase();
}

async function isOutboundLoggingEnabled(kv: KVNamespace): Promise<boolean> {
  return (await kv.get("system:outbound_request_logging_enabled")) === "true";
}

async function writeOutboundLog(
  env: Env,
  req: Request,
  res: Response | null,
  durationMs: number,
  error: unknown,
): Promise<void> {
  if (!(await isOutboundLoggingEnabled(env.KV_SESSIONS))) return;

  const reqBodyText = await req
    .clone()
    .text()
    .catch(() => "");
  const resBodyText = res
    ? await res
        .clone()
        .text()
        .catch(() => "")
    : "";
  const reqUrl = redactUrlForLogging(req.url);
  const details = JSON.stringify({
    outbound: true,
    req: {
      url: reqUrl,
      method: methodFromRequest(req),
      headers: redactHeaders(req.headers),
      body: parseBody(reqBodyText, req.headers.get("content-type")),
    },
    res: res
      ? {
          status: res.status,
          status_text: res.statusText,
          headers: redactHeaders(res.headers),
          body: parseResBody(resBodyText, res.headers.get("content-type")),
        }
      : null,
    error:
      error instanceof Error ? error.message : error ? String(error) : null,
  });

  await env.DB.prepare(
    "INSERT INTO request_logs (id, method, path, status, duration_ms, ip_address, user_agent, user_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      methodFromRequest(req),
      reqUrl,
      res?.status ?? 0,
      durationMs,
      null,
      "outbound-fetch",
      null,
      details,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

async function withOutboundLog(
  env: Env,
  req: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const start = Date.now();
  try {
    const res = await run();
    await writeOutboundLog(
      env,
      req,
      res.clone(),
      Date.now() - start,
      null,
    ).catch(() => {});
    return res;
  } catch (err) {
    await writeOutboundLog(env, req, null, Date.now() - start, err).catch(
      () => {},
    );
    throw err;
  }
}

export async function loggedFetch(
  env: Env,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req = new Request(input, init);
  return withOutboundLog(env, req, () => fetch(req.clone()));
}

/**
 * loggedFetch for a destination the user chose — a webhook endpoint. The URL
 * is checked against the SSRF blocklist before the request and again at every
 * redirect, so an endpoint that validated when it was saved cannot later
 * bounce the worker somewhere it should not reach.
 */
export async function loggedSafeFetch(
  env: Env,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const req = new Request(url, init);
  return withOutboundLog(env, req, () => safeFetch(url, init));
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
        query: redactObject(Object.fromEntries(parsedUrl.searchParams)),
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
  // Same Cloudflare edge geolocation used for sessions/audit, so the admin log
  // viewer can show where each request came from, not just the raw IP.
  const geo = geoJson(c);

  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      "INSERT INTO request_logs (id, method, path, status, duration_ms, ip_address, user_agent, user_id, ip_geo, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        geo,
        details,
        createdAt,
      )
      .run()
      .catch(() => {}),
  );
};
