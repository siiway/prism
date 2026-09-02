// Request / response logger middleware
// Disabled by default — enable via KV key "system:request_logging_enabled" = "true"
// Spectate mode   — set KV key "system:spectate_user_id" to a user ID for full body logging
// Force log all   — set KV key "system:force_log_all" = "true" to capture bodies for every request
// Except pattern  — set KV key "system:log_except_pattern" to skip logging for matching paths
// IP filter       — set KV key "system:log_ip" to restrict full-detail logging to one IP

import type { MiddlewareHandler } from "hono";
import type { Variables } from "../types";
import { readStreamWithLimit } from "./bodyLimit";
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
const OMITTED_OVERSIZED_BODY = "[OMITTED: BODY EXCEEDS 64 KiB LOG LIMIT]";
const OMITTED_INCOMPLETE_BODY = "[OMITTED: BODY DID NOT COMPLETE PROMPTLY]";
const MAX_LOG_BODY_BYTES = 64 * 1024;
const LOG_BODY_CAPTURE_TIMEOUT_MS = 100;
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

type CapturedLogBody = {
  text: string;
  exceeded: boolean;
  incomplete: boolean;
};

async function captureBodyForLogging(
  message: Request | Response,
): Promise<CapturedLogBody> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    LOG_BODY_CAPTURE_TIMEOUT_MS,
  );
  try {
    const captured = await readStreamWithLimit(
      message.clone().body,
      MAX_LOG_BODY_BYTES,
      controller.signal,
    );
    if (captured.exceeded) {
      return { text: "", exceeded: true, incomplete: false };
    }
    return {
      text: new TextDecoder("utf-8", {
        fatal: false,
        ignoreBOM: true,
      }).decode(captured.bytes),
      exceeded: false,
      incomplete: false,
    };
  } catch {
    return { text: "", exceeded: false, incomplete: true };
  } finally {
    clearTimeout(timer);
  }
}

function capturedRequestBody(
  captured: CapturedLogBody,
  contentType: string | null,
): unknown {
  if (captured.exceeded) return OMITTED_OVERSIZED_BODY;
  if (captured.incomplete) return OMITTED_INCOMPLETE_BODY;
  return parseBody(captured.text, contentType);
}

function capturedResponseBody(
  captured: CapturedLogBody,
  contentType: string | null,
): unknown {
  if (captured.exceeded) return OMITTED_OVERSIZED_BODY;
  if (captured.incomplete) return OMITTED_INCOMPLETE_BODY;
  return parseResBody(captured.text, contentType);
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
  reqBodyPromise: Promise<CapturedLogBody>,
  res: Response | null,
  durationMs: number,
  error: unknown,
): Promise<void> {
  const [reqBody, resBody] = await Promise.all([
    reqBodyPromise,
    res
      ? captureBodyForLogging(res)
      : Promise.resolve({ text: "", exceeded: false, incomplete: false }),
  ]);
  const reqUrl = redactUrlForLogging(req.url);
  const details = JSON.stringify({
    outbound: true,
    req: {
      url: reqUrl,
      method: methodFromRequest(req),
      headers: redactHeaders(req.headers),
      body: capturedRequestBody(reqBody, req.headers.get("content-type")),
    },
    res: res
      ? {
          status: res.status,
          status_text: res.statusText,
          headers: redactHeaders(res.headers),
          body: capturedResponseBody(resBody, res.headers.get("content-type")),
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
  const loggingEnabled = await isOutboundLoggingEnabled(env.KV_SESSIONS).catch(
    () => false,
  );
  const reqBodyPromise = loggingEnabled ? captureBodyForLogging(req) : null;
  const start = Date.now();
  try {
    const res = await run();
    if (reqBodyPromise) {
      await writeOutboundLog(
        env,
        req,
        reqBodyPromise,
        res,
        Date.now() - start,
        null,
      ).catch(() => {});
    }
    return res;
  } catch (err) {
    if (reqBodyPromise) {
      await writeOutboundLog(
        env,
        req,
        reqBodyPromise,
        null,
        Date.now() - start,
        err,
      ).catch(() => {});
    }
    throw err;
  }
}

export async function loggedFetch(
  env: Env,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req = new Request(input, init);
  return withOutboundLog(env, req, () => fetch(req));
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

type RequestLoggingFlags = {
  loggingEnabled: boolean;
  forceLogAll: boolean;
  spectateUserId: string | null;
  spectatePathPattern: string | null;
  exceptPattern: string | null;
  logIp: string | null;
};

const DISABLED_LOGGING_FLAGS: RequestLoggingFlags = {
  loggingEnabled: false,
  forceLogAll: false,
  spectateUserId: null,
  spectatePathPattern: null,
  exceptPattern: null,
  logIp: null,
};

let cachedFlags: RequestLoggingFlags = DISABLED_LOGGING_FLAGS;
let cachedKv: KVNamespace | null = null;
let cacheExpiry: number = 0;

async function getFlags(kv: KVNamespace): Promise<RequestLoggingFlags> {
  const now = Date.now();
  if (kv === cachedKv && now < cacheExpiry) return cachedFlags;
  cachedKv = kv;

  const enabled = (await kv.get("system:request_logging_enabled")) === "true";
  if (!enabled) {
    cachedFlags = DISABLED_LOGGING_FLAGS;
    cacheExpiry = now + FLAG_TTL_MS;
    return cachedFlags;
  }

  const [forceAll, spectate, spectatePath, except_, logIp] = await Promise.all([
    kv.get("system:force_log_all"),
    kv.get("system:spectate_user_id"),
    kv.get("system:spectate_path"),
    kv.get("system:log_except_pattern"),
    kv.get("system:log_ip"),
  ]);
  cachedFlags = {
    loggingEnabled: true,
    forceLogAll: forceAll === "true",
    spectateUserId: spectate ?? null,
    spectatePathPattern: spectatePath ?? null,
    exceptPattern: except_ ?? null,
    logIp: logIp ?? null,
  };
  cacheExpiry = now + FLAG_TTL_MS;
  return cachedFlags;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const { method, url } = c.req.raw;
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname;
  const ip =
    c.req.raw.headers.get("cf-connecting-ip") ??
    c.req.raw.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    null;

  // Flags must be known before cloning the request. Disabled logging (the
  // default), exclusions, and IP mismatches never touch the request body.
  const flags = await getFlags(c.env.KV_SESSIONS).catch(
    () => DISABLED_LOGGING_FLAGS,
  );
  const logRequest =
    flags.loggingEnabled &&
    !(flags.exceptPattern && path.includes(flags.exceptPattern)) &&
    !(flags.logIp && ip !== flags.logIp);
  const isSpectatingPath =
    flags.spectatePathPattern !== null &&
    path.includes(flags.spectatePathPattern);
  const mightCaptureDetails =
    logRequest &&
    (flags.forceLogAll || isSpectatingPath || flags.spectateUserId !== null);
  const reqContentType = c.req.raw.headers.get("content-type");
  // User identity is populated by downstream auth middleware, so an explicitly
  // configured user spectate may need to prepare a body before the match is
  // known. Even then, the read is capped and cancelled after 64 KiB.
  const reqBodyPromise = mightCaptureDetails
    ? captureBodyForLogging(c.req.raw)
    : null;

  await next();

  const durationMs = Date.now() - start;
  const status = c.res.status;
  const userAgent = c.req.raw.headers.get("user-agent") ?? null;
  const userId = (c.get("user") as { id?: string } | undefined)?.id ?? null;

  // Always log minimal metadata to console.
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

  if (!logRequest) return;

  const isSpectatingUser =
    flags.spectateUserId !== null && userId === flags.spectateUserId;
  const captureDetails =
    flags.forceLogAll || isSpectatingUser || isSpectatingPath;

  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  // Same Cloudflare edge geolocation used for sessions/audit, so the admin log
  // viewer can show where each request came from, not just the raw IP.
  const geo = geoJson(c);

  // Body capture and the D1 write stay off the response path. The response is
  // cloned synchronously, then the capped read finishes under waitUntil.
  const writeLog = async () => {
    let details: string | null = null;
    if (captureDetails && reqBodyPromise) {
      const [reqBody, resBody] = await Promise.all([
        reqBodyPromise,
        captureBodyForLogging(c.res),
      ]);
      details = JSON.stringify({
        req: {
          headers: redactHeaders(c.req.raw.headers),
          query: redactObject(Object.fromEntries(parsedUrl.searchParams)),
          body: capturedRequestBody(reqBody, reqContentType),
        },
        res: {
          headers: redactHeaders(c.res.headers),
          body: capturedResponseBody(
            resBody,
            c.res.headers.get("content-type"),
          ),
        },
      });
    }

    await c.env.DB.prepare(
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
      .run();
  };
  c.executionCtx.waitUntil(writeLog().catch(() => {}));
};
