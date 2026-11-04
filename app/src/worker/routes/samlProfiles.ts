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
  countSharedProfiles,
  getProfile,
  listProfiles,
  profileKind,
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
    kind: profileKind(p),
    name: p.name,
    name_id: p.name_id,
    apps: p.apps,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/** The profile `id` of the signed-in user, with its apps; null if none. */
const findProfile = (c: Context<AppEnv>, id: string) =>
  getProfile(c.env.DB, c.get("user").id, id);

/** A 409 when the user has as many shared profiles as allowed. */
async function sharedLimit(c: Context<AppEnv>, userId: string) {
  return (await countSharedProfiles(c.env.DB, userId)) >= MAX_SHARED_PROFILES
    ? c.json(
        { error: "saml_profile_limit", params: { max: MAX_SHARED_PROFILES } },
        409,
      )
    : null;
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
  const limited = await sharedLimit(c, userId);
  if (limited) return limited;
  const now = Math.floor(Date.now() / 1000);
  const profile: SamlProfileRow = {
    id: randomId(),
    user_id: userId,
    name_id: randomId(16),
    app_id: null,
    name: read.name,
    created_at: now,
    updated_at: now,
  };
  await c.env.DB.prepare(
    `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(profile.id, userId, profile.name_id, profile.name, now, now)
    .run();
  return c.json({ profile: view({ ...profile, apps: [] }) }, 201);
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
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE saml_profiles SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
  )
    .bind(read.name, now, profile.id, profile.user_id)
    .run();
  return c.json({
    profile: view({ ...profile, name: read.name, updated_at: now }),
  });
});

app.post("/:id/share", async (c) => {
  const profile = await findProfile(c, c.req.param("id"));
  if (!profile) return notFound(c);
  if (!profile.app_id)
    return c.json({ error: "saml_profile_already_shared" }, 409);
  const read = await readName(c);
  if ("error" in read) return read.error;
  const limited = await sharedLimit(c, profile.user_id);
  if (limited) return limited;
  // Same row, same ID: the app it was made for keeps seeing the same user.
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `UPDATE saml_profiles SET app_id = NULL, name = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id IS NOT NULL`,
  )
    .bind(read.name, now, profile.id, profile.user_id)
    .run();
  return c.json({
    profile: view({
      ...profile,
      app_id: null,
      name: read.name,
      updated_at: now,
    }),
  });
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
