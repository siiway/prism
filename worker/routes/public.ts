// Public non-API routes (accessible without authentication)

import { Hono } from "hono";
import type { Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /users/:username.gpg — all registered public GPG keys for a user
app.get("/users/:username{.+\\.gpg}", async (c) => {
  const raw = c.req.param("username");
  const username = raw.replace(/\.gpg$/, "").toLowerCase();

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: string }>();
  if (!user) return new Response("Not found\n", { status: 404 });

  const { results } = await c.env.DB.prepare(
    "SELECT public_key FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<{ public_key: string }>();

  if (results.length === 0) return new Response("", { status: 404 });

  const body = results.map((r) => r.public_key.trim()).join("\n\n");
  return new Response(body + "\n", {
    headers: {
      "Content-Type": "application/pgp-keys",
      "Cache-Control": "public, max-age=300",
    },
  });
});

export default app;
