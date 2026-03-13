// Request / response logger middleware
// Disabled by default — enable via KV key "system:request_logging_enabled" = "true"
// Spectate mode   — set KV key "system:spectate_user_id" to a user ID for full body logging

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

// ─── Module-level KV flag cache (avoids a KV read on every request) ───────────

const FLAG_TTL_MS = 10_000; // re-check KV every 10 seconds

let cachedLoggingEnabled: boolean = false;
let cachedSpectateUserId: string | null = null;
let cachedSpectatePathPattern: string | null = null;
let cacheExpiry: number = 0;

async function getFlags(kv: KVNamespace): Promise<{
  loggingEnabled: boolean;
  spectateUserId: string | null;
  spectatePathPattern: string | null;
}> {
  const now = Date.now();
  if (now < cacheExpiry) {
    return {
      loggingEnabled: cachedLoggingEnabled,
      spectateUserId: cachedSpectateUserId,
      spectatePathPattern: cachedSpectatePathPattern,
    };
  }
  const [enabled, spectate, spectatePath] = await Promise.all([
    kv.get("system:request_logging_enabled"),
    kv.get("system:spectate_user_id"),
    kv.get("system:spectate_path"),
  ]);
  cachedLoggingEnabled = enabled === "true";
  cachedSpectateUserId = spectate ?? null;
  cachedSpectatePathPattern = spectatePath ?? null;
  cacheExpiry = now + FLAG_TTL_MS;
  return {
    loggingEnabled: cachedLoggingEnabled,
    spectateUserId: cachedSpectateUserId,
    spectatePathPattern: cachedSpectatePathPattern,
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();

  // Read body before Hono consumes it (only needed for spectate details)
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

  const { loggingEnabled, spectateUserId, spectatePathPattern } =
    await getFlags(c.env.KV_SESSIONS);
  if (!loggingEnabled) return;

  const isSpectatingUser = spectateUserId !== null && userId === spectateUserId;
  const isSpectatingPath =
    spectatePathPattern !== null && path.includes(spectatePathPattern);
  const isSpectating = isSpectatingUser || isSpectatingPath;

  let details: string | null = null;
  if (isSpectating) {
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
        body:
          resContentType?.includes("application/json") && resBodyText
            ? (() => {
                try {
                  return redactObject(
                    JSON.parse(resBodyText) as Record<string, unknown>,
                  );
                } catch {
                  return resBodyText.slice(0, 2048);
                }
              })()
            : resBodyText.slice(0, 2048),
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
