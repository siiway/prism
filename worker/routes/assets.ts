// R2 asset serving

import { Hono } from "hono";
import type { Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/*", async (c) => {
  if (!c.env.R2_ASSETS) return c.json({ error: "Not found" }, 404);
  const key = c.req.path.replace("/api/assets/", "");
  const obj = await c.env.R2_ASSETS.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Access-Control-Allow-Origin", "*");
  // The stored content type comes from the uploader, so serve these the way
  // the image proxy does: no sniffing past the declared type, and nothing
  // the file references may load if a browser renders it as a document.
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'",
  );
  return new Response(obj.body, { headers });
});

export default app;
