// A user's SAML profiles (lib/saml/profiles.ts), mounted at
// /api/saml/profiles:
//
//   GET    /             all of them, each with the apps it's used for
//   POST   /             make a shared profile { name }
//   GET    /:id          one
//   PATCH  /:id          rename a shared profile { name }
//   POST   /:id/share    turn a per-app profile into a shared one { name };
//                       it keeps its ID, so its app sees no change
//   DELETE /:id          delete a shared profile no app uses
//
// A per-app profile goes with its app; it can't be renamed or deleted on its
// own. Which profile an app gets is chosen when the user first signs in to
// it (routes/saml.ts), and then stays.

import { Hono, type Context } from "hono";
import { requireAuth } from "../middleware/auth";
import { randomId } from "../lib/crypto";
import {
  MAX_PROFILE_NAME,
  MAX_SHARED_PROFILES,
  listProfiles,
  type ProfileApp,
  type SamlProfileRow,
} from "../lib/saml/profiles";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

const app = new Hono<AppEnv>();
app.use("*", requireAuth);

function view(p: SamlProfileRow & { apps: ProfileApp[] }) {
  return {
    id: p.id,
    kind: p.app_id ? ("app" as const) : ("shared" as const),
    name: p.name,
    name_id: p.name_id,
    apps: p.apps,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/** The profile `id` of the signed-in user, with its apps; null if none. */
async function findProfile(c: Context<AppEnv>, id: string) {
  const profiles = await listProfiles(c.env.DB, c.get("user").id);
  return profiles.find((p) => p.id === id) ?? null;
}

/** A shared profile's name from the body, or an error response. */
async function readName(
  c: Context<AppEnv>,
): Promise<{ name: string } | { error: Response }> {
  const body = await c.req
    .json<{ name?: unknown }>()
    .catch(() => ({}) as { name?: unknown });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name)
    return {
      error: c.json(
        { error: "field_required", params: { field: "name" } },
        400,
      ),
    };
  if ([...name].length > MAX_PROFILE_NAME)
    return {
      error: c.json(
        {
          error: "field_max_length",
          params: { field: "name", max: MAX_PROFILE_NAME },
        },
        400,
      ),
    };
  return { name };
}

const notFound = (c: Context<AppEnv>) =>
  c.json({ error: "saml_profile_not_found" }, 404);

app.get("/", async (c) => {
  const profiles = await listProfiles(c.env.DB, c.get("user").id);
  return c.json({ profiles: profiles.map(view) });
});

app.post("/", async (c) => {
  const userId = c.get("user").id;
  const read = await readName(c);
  if ("error" in read) return read.error;
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM saml_profiles WHERE user_id = ? AND app_id IS NULL",
  )
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_SHARED_PROFILES)
    return c.json(
      { error: "saml_profile_limit", params: { max: MAX_SHARED_PROFILES } },
      409,
    );
  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(id, userId, randomId(16), read.name, now, now)
    .run();
  const profile = await findProfile(c, id);
  return c.json({ profile: view(profile!) }, 201);
});

app.get("/:id", async (c) => {
  const profile = await findProfile(c, c.req.param("id"));
  return profile ? c.json({ profile: view(profile) }) : notFound(c);
});

app.patch("/:id", async (c) => {
  const profile = await findProfile(c, c.req.param("id"));
  if (!profile) return notFound(c);
  if (profile.app_id) return c.json({ error: "saml_profile_per_app" }, 409);
  const read = await readName(c);
  if ("error" in read) return read.error;
  await c.env.DB.prepare(
    "UPDATE saml_profiles SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
  )
    .bind(read.name, Math.floor(Date.now() / 1000), profile.id, profile.user_id)
    .run();
  return c.json({ profile: view((await findProfile(c, profile.id))!) });
});

app.post("/:id/share", async (c) => {
  const profile = await findProfile(c, c.req.param("id"));
  if (!profile) return notFound(c);
  if (!profile.app_id)
    return c.json({ error: "saml_profile_already_shared" }, 409);
  const read = await readName(c);
  if ("error" in read) return read.error;
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM saml_profiles WHERE user_id = ? AND app_id IS NULL",
  )
    .bind(profile.user_id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_SHARED_PROFILES)
    return c.json(
      { error: "saml_profile_limit", params: { max: MAX_SHARED_PROFILES } },
      409,
    );
  // Same row, same ID: the app it was made for keeps seeing the same user.
  await c.env.DB.prepare(
    `UPDATE saml_profiles SET app_id = NULL, name = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id IS NOT NULL`,
  )
    .bind(read.name, Math.floor(Date.now() / 1000), profile.id, profile.user_id)
    .run();
  return c.json({ profile: view((await findProfile(c, profile.id))!) });
});

app.delete("/:id", async (c) => {
  const profile = await findProfile(c, c.req.param("id"));
  if (!profile) return notFound(c);
  if (profile.app_id) return c.json({ error: "saml_profile_per_app" }, 409);
  // An app using it would lose the identity it knows the user by.
  if (profile.apps.length > 0)
    return c.json(
      {
        error: "saml_profile_in_use",
        params: { count: profile.apps.length },
      },
      409,
    );
  await c.env.DB.prepare(
    `DELETE FROM saml_profiles WHERE id = ? AND user_id = ? AND app_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM saml_profile_apps WHERE profile_id = saml_profiles.id)`,
  )
    .bind(profile.id, profile.user_id)
    .run();
  return c.json({ ok: true });
});

export default app;
