// Image reverse proxy — streams external images through the worker.
// SVGs are sanitized to remove script execution vectors before being served.
//
// The proxy is no longer an open relay: instead of accepting an arbitrary
// URL on the request, it looks up an opaque id in image_proxy_mappings.
// URLs are registered server-side when avatars/icons are written or
// rendered, and via POST /register for client-driven cases (markdown
// previews, ImageUrlInput previews). Anything not in the mapping table
// 404s.

import { Hono } from "hono";
import type { Variables } from "../types";
import {
  BodySizeLimitError,
  cancelStream,
  declaredLengthExceedsLimit,
  limitStreamBytes,
  readStreamWithLimit,
} from "../lib/bodyLimit";
import { isBlockedHost, safeFetch } from "../lib/safeFetch";
import { registerImageProxyMapping } from "../lib/proxyImage";
import { getConfig } from "../lib/config";
import { requireAuth } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
]);

/**
 * Sanitize an SVG string by stripping all known script execution vectors:
 *  - <script> elements
 *  - event-handler attributes (on*)
 *  - javascript: pseudo-URLs in href/src/xlink:href
 *  - <foreignObject> (can embed arbitrary HTML)
 *  - <use> with external (non-fragment) hrefs (prevents sprite-sheet injection)
 */
export function sanitizeSvg(raw: string): string {
  return (
    raw
      .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
      .replace(/<!ENTITY[\s\S]*?>/gi, "")
      // Remove <script> blocks
      .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
      // Remove inline event handlers  on*="..."  on*='...'
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]*)/gi, "")
      // Neutralise javascript: in href / src / xlink:href
      .replace(
        /((?:xlink:)?href|src)\s*=\s*["']\s*javascript:[^"']*/gi,
        '$1=""',
      )
      // Remove <foreignObject> (embeds HTML)
      .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
      .replace(
        /<(?:iframe|object|embed|audio|video|image)\b[\s\S]*?(?:<\/\w+\s*>|\/?>)/gi,
        "",
      )
      .replace(/<style[\s\S]*?<\/style\s*>/gi, "")
      // Remove <use> references to external resources (keep fragment-only refs)
      .replace(
        /<use([^>]+)(?:xlink:href|href)\s*=\s*["'](?!#)[^"']*["']/gi,
        (_, attrs) =>
          `<use${attrs
            .replace(/xlink:href\s*=\s*["'][^"']*["']/gi, "")
            .replace(/href\s*=\s*["'][^"']*["']/gi, "")}`,
      )
  );
}

function responseHeaders(contentType: string, ttl: number): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": `public, max-age=${ttl}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
}

async function readCached(
  c: import("hono").Context<AppEnv>,
  id: string,
  mode: "off" | "kv" | "d1",
) {
  if (mode === "kv") {
    const value = await c.env.KV_CACHE.getWithMetadata<{
      contentType?: string;
    }>(`avatar:${id}`, "arrayBuffer");
    if (value.value && value.metadata?.contentType)
      return {
        bytes: new Uint8Array(value.value),
        contentType: value.metadata.contentType,
      };
  }
  if (mode === "d1") {
    const row = await c.env.DB.prepare(
      "SELECT body, content_type FROM avatar_proxy_cache WHERE mapping_id = ? AND expires_at > ?",
    )
      .bind(id, Math.floor(Date.now() / 1000))
      .first<{ body: ArrayBuffer; content_type: string }>();
    if (row)
      return { bytes: new Uint8Array(row.body), contentType: row.content_type };
  }
  return null;
}

async function writeCached(
  c: import("hono").Context<AppEnv>,
  id: string,
  bytes: Uint8Array,
  contentType: string,
  mode: "off" | "kv" | "d1",
  ttl: number,
) {
  if (mode === "kv") {
    await c.env.KV_CACHE.put(`avatar:${id}`, bytes, {
      expirationTtl: Math.max(60, ttl),
      metadata: { contentType },
    });
  } else if (mode === "d1") {
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `INSERT INTO avatar_proxy_cache (mapping_id, content_type, body, size_bytes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(mapping_id) DO UPDATE SET content_type=excluded.content_type, body=excluded.body,
       size_bytes=excluded.size_bytes, expires_at=excluded.expires_at, created_at=excluded.created_at`,
    )
      .bind(id, contentType, bytes, bytes.byteLength, now + ttl, now)
      .run();
  }
}

/**
 * Authenticated registration endpoint. Lets the client pre-register an
 * external image URL (for example, an <img> in a markdown blob the
 * viewer is about to render, or the live preview in ImageUrlInput) and
 * receive back the opaque id used in /api/proxy/image/<id>.
 *
 * Auth is required so the proxy table can't be used as a general fetch
 * relay by unauthenticated traffic. Hosts on the SSRF blocklist are
 * rejected up front.
 */
app.post("/register", requireAuth, async (c) => {
  let body: { url?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.url !== "string" || !body.url) {
    return c.json({ error: "url is required" }, 400);
  }
  const raw = body.url.trim();
  if (raw.length > 2048) {
    return c.json({ error: "url exceeds the 2048-character limit" }, 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }
  if (parsed.protocol !== "https:") {
    return c.json({ error: "Only HTTPS URLs are allowed" }, 400);
  }
  if (isBlockedHost(parsed.hostname)) {
    return c.json({ error: "Host not allowed" }, 400);
  }
  const user = c.get("user");
  const id = await registerImageProxyMapping(c.env.DB, raw, user?.id ?? null);
  return c.json({ id });
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{32}$/.test(id)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const row = await c.env.DB.prepare(
    "SELECT url FROM image_proxy_mappings WHERE id = ?",
  )
    .bind(id)
    .first<{ url: string }>();
  if (!row) return c.json({ error: "Unknown image id" }, 404);

  const config = await getConfig(c.env.DB);
  const maxBytes = Math.min(
    Math.max(config.avatar_proxy_max_source_bytes, 64 * 1024),
    25 * 1024 * 1024,
  );
  const cacheMaxBytes = Math.min(
    Math.max(config.avatar_proxy_max_cache_bytes, 64 * 1024),
    maxBytes,
  );
  const ttl = Math.min(
    Math.max(config.avatar_proxy_cache_ttl_seconds, 60),
    31_536_000,
  );
  const cached = await readCached(c, id, config.avatar_proxy_cache_mode);
  if (cached)
    return new Response(cached.bytes, {
      headers: responseHeaders(cached.contentType, ttl),
    });

  const rawUrl = row.url;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return c.json({ error: "Invalid stored URL" }, 500);
  }

  if (parsed.protocol !== "https:") {
    return c.json({ error: "Only HTTPS URLs are allowed" }, 400);
  }

  if (isBlockedHost(parsed.hostname)) {
    return c.json({ error: "Host not allowed" }, 400);
  }

  let upstream: Response;
  try {
    // safeFetch re-applies the host check to every redirect hop. Without it
    // the mapping's host is checked once here and the upstream is free to
    // bounce the worker onto a blocked address afterwards.
    upstream = await safeFetch(rawUrl, {
      method: "GET",
      headers: { Accept: "image/*" },
      // Ask Cloudflare to cache the upstream response
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit);
  } catch {
    return c.json({ error: "Could not reach upstream URL" }, 502);
  }

  if (!upstream.ok) {
    cancelStream(upstream.body);
    return c.json({ error: `Upstream returned HTTP ${upstream.status}` }, 502);
  }

  const rawCt = upstream.headers.get("content-type") ?? "";
  const ct = rawCt.toLowerCase().split(";")[0].trim();

  if (!ALLOWED_TYPES.has(ct)) {
    cancelStream(upstream.body);
    return c.json({ error: "Upstream URL is not an image" }, 400);
  }

  if (
    declaredLengthExceedsLimit(upstream.headers.get("content-length"), maxBytes)
  ) {
    cancelStream(upstream.body, new BodySizeLimitError(maxBytes));
    return c.json({ error: "Avatar exceeds the configured size limit" }, 400);
  }

  const headers = responseHeaders(ct, ttl);

  if (ct === "image/svg+xml") {
    let captured;
    try {
      captured = await readStreamWithLimit(upstream.body, maxBytes);
    } catch {
      return c.json({ error: "Could not read upstream image" }, 502);
    }
    if (captured.exceeded) {
      return c.json({ error: "Avatar exceeds the configured size limit" }, 400);
    }
    const bytes = new TextEncoder().encode(
      sanitizeSvg(new TextDecoder().decode(captured.bytes)),
    );
    if (bytes.byteLength <= cacheMaxBytes)
      c.executionCtx.waitUntil(
        writeCached(c, id, bytes, ct, config.avatar_proxy_cache_mode, ttl),
      );
    return new Response(bytes, { headers });
  }

  if (
    config.avatar_proxy_cache_mode !== "off" ||
    config.avatar_proxy_convert_to_webp
  ) {
    const captured = await readStreamWithLimit(upstream.body, maxBytes);
    if (captured.exceeded)
      return c.json({ error: "Avatar exceeds the configured size limit" }, 400);
    let bytes = captured.bytes;
    let contentType = ct;
    if (config.avatar_proxy_convert_to_webp && c.env.IMAGES) {
      try {
        const result = await c.env.IMAGES.input(new Blob([bytes]).stream())
          .transform({ fit: "scale-down", width: 1024, height: 1024 })
          .output({ format: "image/webp", quality: 80 });
        const converted = await readStreamWithLimit(
          result.image(),
          cacheMaxBytes,
        );
        if (converted.exceeded || !converted.bytes)
          throw new Error("Converted avatar exceeds cache limit");
        bytes = converted.bytes;
        contentType = "image/webp";
      } catch {
        // Preserve the validated source image when optional conversion fails.
      }
    }
    if (bytes.byteLength <= cacheMaxBytes)
      c.executionCtx.waitUntil(
        writeCached(
          c,
          id,
          bytes,
          contentType,
          config.avatar_proxy_cache_mode,
          ttl,
        ),
      );
    return new Response(bytes, { headers: responseHeaders(contentType, ttl) });
  }

  return new Response(
    upstream.body ? limitStreamBytes(upstream.body, maxBytes) : null,
    { headers },
  );
});

export default app;
