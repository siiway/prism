// Public-facing user profile lookup. Visibility is gated by:
//   1. site config `enable_public_profiles` (master kill switch)
//   2. the user's own `profile_is_public` opt-in
// Per-field show_* flags fall back to site defaults when NULL. We respond
// 404 (not 403) for both "user doesn't exist" and "user opted out", so the
// endpoint doesn't leak the existence of usernames.

import { Hono } from "hono";
import { optionalAuth } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { proxyImageUrl } from "../lib/proxyImage";
import type { UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.get("/:username", optionalAuth, async (c) => {
  const username = (c.req.param("username") ?? "").toLowerCase();
  if (!username) return c.json({ error: "Not found" }, 404);
  const config = await getConfig(c.env.DB);
  if (!config.enable_public_profiles) {
    return c.json({ error: "Not found" }, 404);
  }

  const row = await c.env.DB.prepare(
    "SELECT * FROM users WHERE username = ? AND is_active = 1",
  )
    .bind(username)
    .first<UserRow>();

  // Owner can always see their own profile (otherwise the "View public
  // profile" link from settings would 404 the moment they make it private).
  const viewer = c.get("user");
  const isOwner = viewer?.id === row?.id;

  if (!row || (!row.profile_is_public && !isOwner)) {
    return c.json({ error: "Not found" }, 404);
  }

  const resolve = (userValue: number | null, siteDefault: boolean): boolean =>
    userValue === null ? siteDefault : userValue === 1;

  const showDisplayName = resolve(
    row.profile_show_display_name,
    config.default_profile_show_display_name,
  );
  const showAvatar = resolve(
    row.profile_show_avatar,
    config.default_profile_show_avatar,
  );
  const showEmail = resolve(
    row.profile_show_email,
    config.default_profile_show_email,
  );
  const showJoinedAt = resolve(
    row.profile_show_joined_at,
    config.default_profile_show_joined_at,
  );
  const showGpgKeys = resolve(
    row.profile_show_gpg_keys,
    config.default_profile_show_gpg_keys,
  );
  const showAuthorizedApps = resolve(
    row.profile_show_authorized_apps,
    config.default_profile_show_authorized_apps,
  );
  const showOwnedApps = resolve(
    row.profile_show_owned_apps,
    config.default_profile_show_owned_apps,
  );
  const showDomains = resolve(
    row.profile_show_domains,
    config.default_profile_show_domains,
  );
  const showJoinedTeams = resolve(
    row.profile_show_joined_teams,
    config.default_profile_show_joined_teams,
  );

  // Each related-table query is gated by its own visibility flag so we don't
  // hit the DB for sections nobody can see.
  const [gpgKeys, authorizedApps, ownedApps, domains, joinedTeams] =
    await Promise.all([
      showGpgKeys
        ? c.env.DB.prepare(
            `SELECT fingerprint, key_id, name, created_at
           FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at ASC`,
          )
            .bind(row.id)
            .all<{
              fingerprint: string;
              key_id: string;
              name: string;
              created_at: number;
            }>()
        : Promise.resolve(null),
      showAuthorizedApps
        ? c.env.DB.prepare(
            `SELECT oa.client_id, oa.name, oa.icon_url, oa.website_url, oc.granted_at
           FROM oauth_consents oc
           JOIN oauth_apps oa ON oa.client_id = oc.client_id
           WHERE oc.user_id = ? AND oa.is_active = 1
           ORDER BY oc.granted_at DESC`,
          )
            .bind(row.id)
            .all<{
              client_id: string;
              name: string;
              icon_url: string | null;
              website_url: string | null;
              granted_at: number;
            }>()
        : Promise.resolve(null),
      showOwnedApps
        ? c.env.DB.prepare(
            `SELECT id, client_id, name, description, icon_url, website_url, created_at
           FROM oauth_apps
           WHERE owner_id = ? AND is_active = 1
           ORDER BY created_at ASC`,
          )
            .bind(row.id)
            .all<{
              id: string;
              client_id: string;
              name: string;
              description: string;
              icon_url: string | null;
              website_url: string | null;
              created_at: number;
            }>()
        : Promise.resolve(null),
      showDomains
        ? c.env.DB.prepare(
            `SELECT domain, verified_at
           FROM domains
           WHERE user_id = ? AND team_id IS NULL AND verified = 1
           ORDER BY verified_at ASC`,
          )
            .bind(row.id)
            .all<{ domain: string; verified_at: number | null }>()
        : Promise.resolve(null),
      // Joined teams: only public teams, gated by both the user's master flag
      // and any per-team override on team_members.show_on_profile (NULL =
      // follow master, 0 = explicitly hidden, 1 = explicitly shown — also
      // overrides a master-off).
      showJoinedTeams
        ? c.env.DB.prepare(
            `SELECT t.id, t.name, t.avatar_url, tm.role, tm.show_on_profile
           FROM team_members tm
           JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id = ?
             AND t.profile_is_public = 1
             AND (tm.show_on_profile IS NULL OR tm.show_on_profile = 1)
           ORDER BY tm.joined_at ASC`,
          )
            .bind(row.id)
            .all<{
              id: string;
              name: string;
              avatar_url: string | null;
              role: string;
              show_on_profile: number | null;
            }>()
        : // Even when the master toggle is off, surface any team the user
          // *explicitly* opted into. Lets a user keep their joined-teams
          // section private by default but still pin one or two.
          c.env.DB.prepare(
            `SELECT t.id, t.name, t.avatar_url, tm.role, tm.show_on_profile
           FROM team_members tm
           JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id = ?
             AND t.profile_is_public = 1
             AND tm.show_on_profile = 1
           ORDER BY tm.joined_at ASC`,
          )
            .bind(row.id)
            .all<{
              id: string;
              name: string;
              avatar_url: string | null;
              role: string;
              show_on_profile: number | null;
            }>(),
    ]);

  return c.json({
    profile: {
      username: row.username,
      display_name: showDisplayName ? row.display_name : null,
      avatar_url: showAvatar
        ? proxyImageUrl(c.env.APP_URL, row.avatar_url)
        : null,
      unproxied_avatar_url: showAvatar ? row.avatar_url : null,
      email: showEmail ? row.email : null,
      joined_at: showJoinedAt ? row.created_at : null,
      gpg_keys:
        gpgKeys?.results.map((k) => ({
          fingerprint: k.fingerprint,
          key_id: k.key_id,
          name: k.name,
          created_at: k.created_at,
        })) ?? null,
      authorized_apps:
        authorizedApps?.results.map((a) => ({
          client_id: a.client_id,
          name: a.name,
          icon_url: proxyImageUrl(c.env.APP_URL, a.icon_url),
          website_url: a.website_url,
          granted_at: a.granted_at,
        })) ?? null,
      owned_apps:
        ownedApps?.results.map((a) => ({
          id: a.id,
          client_id: a.client_id,
          name: a.name,
          description: a.description,
          icon_url: proxyImageUrl(c.env.APP_URL, a.icon_url),
          website_url: a.website_url,
          created_at: a.created_at,
        })) ?? null,
      domains:
        domains?.results.map((d) => ({
          domain: d.domain,
          verified_at: d.verified_at,
        })) ?? null,
      // joined_teams is null only when there's nothing to show AND the
      // master toggle says hide. When master is on but the user has
      // 0 visible teams, return [] (so the UI can render an empty section).
      joined_teams:
        showJoinedTeams || (joinedTeams?.results.length ?? 0) > 0
          ? (joinedTeams?.results.map((t) => ({
              id: t.id,
              name: t.name,
              avatar_url: proxyImageUrl(c.env.APP_URL, t.avatar_url),
              role: t.role,
            })) ?? [])
          : null,
    },
  });
});

export default app;
