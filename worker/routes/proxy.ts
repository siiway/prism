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
import { requireAuth } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
function sanitizeSvg(raw: string): string {
  return (
    raw
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
    declaredLengthExceedsLimit(
      upstream.headers.get("content-length"),
      MAX_BYTES,
    )
  ) {
    cancelStream(upstream.body, new BodySizeLimitError(MAX_BYTES));
    return c.json({ error: "Image exceeds the 5 MB size limit" }, 400);
  }

  const headers = new Headers({
    "Content-Type": ct,
    "Cache-Control": "public, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff",
    // Prevent the SVG from loading external resources or running scripts
    // even if the browser decides to render it as a document
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });

  if (ct === "image/svg+xml") {
    let captured;
    try {
      captured = await readStreamWithLimit(upstream.body, MAX_BYTES);
    } catch {
      return c.json({ error: "Could not read upstream image" }, 502);
    }
    if (captured.exceeded) {
      return c.json({ error: "Image exceeds the 5 MB size limit" }, 400);
    }
    const sanitized = sanitizeSvg(new TextDecoder().decode(captured.bytes));
    return new Response(sanitized, { headers });
  }

  // Raster formats need no rewriting. Forward them a chunk at a time; if a
  // missing or dishonest Content-Length crosses the cap, the stream errors and
  // its upstream source is cancelled instead of being buffered without bound.
  return new Response(
    upstream.body ? limitStreamBytes(upstream.body, MAX_BYTES) : null,
    { headers },
  );
});

export default app;
