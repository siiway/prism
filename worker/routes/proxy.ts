// Image reverse proxy — streams external images through the worker.
// SVGs are sanitized to remove script execution vectors before being served.

import { Hono } from "hono";
import type { Variables } from "../types";
import { isBlockedHost } from "../lib/safeFetch";

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

app.get("/", async (c) => {
  const encoded = c.req.query("url");
  if (!encoded) return c.json({ error: "url parameter required" }, 400);

  let rawUrl: string;
  try {
    rawUrl = atob(encoded);
  } catch {
    return c.json({ error: "Invalid base64 encoding" }, 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  if (parsed.protocol !== "https:") {
    return c.json({ error: "Only HTTPS URLs are allowed" }, 400);
  }

  if (isBlockedHost(parsed.hostname)) {
    return c.json({ error: "Host not allowed" }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(rawUrl, {
      method: "GET",
      headers: { Accept: "image/*" },
      // Ask Cloudflare to cache the upstream response
      // @ts-ignore — cf is a CF-specific fetch option
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch {
    return c.json({ error: "Could not reach upstream URL" }, 502);
  }

  if (!upstream.ok) {
    return c.json({ error: `Upstream returned HTTP ${upstream.status}` }, 502);
  }

  const rawCt = upstream.headers.get("content-type") ?? "";
  const ct = rawCt.toLowerCase().split(";")[0].trim();

  if (!ALLOWED_TYPES.has(ct)) {
    return c.json({ error: "Upstream URL is not an image" }, 400);
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
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
    const sanitized = sanitizeSvg(new TextDecoder().decode(buf));
    return new Response(sanitized, { headers });
  }

  return new Response(buf, { headers });
});

export default app;
