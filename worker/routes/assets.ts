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
  return new Response(obj.body, { headers });
});

export default app;
