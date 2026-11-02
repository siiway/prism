// Public-facing user profile lookup. Visibility is gated by:
//   1. site config `enable_public_profiles` (master kill switch)
//   2. the user's own `profile_is_public` opt-in
// Per-field show_* flags fall back to site defaults when NULL. We respond
// 404 (not 403) for both "user doesn't exist" and "user opted out", so the
// endpoint doesn't leak the existence of usernames.

import { Hono } from "hono";
import { optionalAuth } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { getGithubReadmeFromCache } from "../lib/githubReadme";
import { proxyImageUrl } from "../lib/proxyImage";
import { listPublicApps, listPublicDomains } from "../lib/publicProfile";
import type { UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.get("/:username", optionalAuth, async (c) => {
  const username = (c.req.param("username") ?? "").toLowerCase();
  if (!username) return c.json({ error: "not_found" }, 404);
  const config = await getConfig(c.env.DB);
  if (!config.enable_public_profiles) {
    return c.json({ error: "not_found" }, 404);
  }

  const row = await c.env.DB.prepare(
    "SELECT * FROM users WHERE username = ? AND is_active = 1 AND kind = 'user'",
  )
    .bind(username)
    .first<UserRow>();

  // Owner can always see their own profile (otherwise the "View public
  // profile" link from settings would 404 the moment they make it private).
  const viewer = c.get("user");
  const isOwner = viewer?.id === row?.id;

  if (!row || (!row.profile_is_public && !isOwner)) {
    return c.json({ error: "not_found" }, 404);
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
  const showReadme = resolve(
    row.profile_show_readme,
    config.default_profile_show_readme,
  );

  // Joined teams: only public teams. With the user's master flag on, every
  // team they haven't hidden (team_members.show_on_profile NULL = follow
  // master, 0 = hidden, 1 = shown). With it off, only teams they pinned
  // explicitly, so a user can keep the section private but still show one or
  // two.
  const shownTeams = showJoinedTeams
    ? "(tm.show_on_profile IS NULL OR tm.show_on_profile = 1)"
    : "tm.show_on_profile = 1";

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
        ? listPublicApps(c.env, { userId: row.id })
        : Promise.resolve(null),
      showDomains
        ? listPublicDomains(c.env.DB, { userId: row.id })
        : Promise.resolve(null),
      c.env.DB.prepare(
        `SELECT t.id, t.name, t.avatar_url, tm.role
           FROM team_members tm
           JOIN teams t ON t.id = tm.team_id
          WHERE tm.user_id = ?
            AND t.profile_is_public = 1
            AND ${shownTeams}
          ORDER BY tm.joined_at ASC`,
      )
        .bind(row.id)
        .all<{
          id: string;
          name: string;
          avatar_url: string | null;
          role: string;
        }>(),
    ]);

  return c.json({
    profile: {
      username: row.username,
      display_name: showDisplayName ? row.display_name : null,
      avatar_url: showAvatar
        ? await proxyImageUrl(c.env.APP_URL, c.env.DB, row.avatar_url)
        : null,
      unproxied_avatar_url: showAvatar ? row.avatar_url : null,
      email: showEmail ? row.email : null,
      joined_at: showJoinedAt ? row.created_at : null,
      gpg_keys: gpgKeys?.results ?? null,
      authorized_apps: authorizedApps
        ? await Promise.all(
            authorizedApps.results.map(async (a) => ({
              client_id: a.client_id,
              name: a.name,
              icon_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                a.icon_url,
              ),
              website_url: a.website_url,
              granted_at: a.granted_at,
            })),
          )
        : null,
      owned_apps: ownedApps,
      domains,
      // joined_teams is null only when there's nothing to show AND the
      // master toggle says hide. When master is on but the user has
      // 0 visible teams, return [] (so the UI can render an empty section).
      joined_teams:
        showJoinedTeams || joinedTeams.results.length > 0
          ? await Promise.all(
              joinedTeams.results.map(async (t) => ({
                id: t.id,
                name: t.name,
                avatar_url: await proxyImageUrl(
                  c.env.APP_URL,
                  c.env.DB,
                  t.avatar_url,
                ),
                role: t.role,
              })),
            )
          : null,
      // Raw markdown — the client sanitizes and rewrites images through the
      // proxy when rendering. We never render server-side, so no XSS surface
      // is introduced by returning the source verbatim. Source resolution is
      // delegated to resolveReadme below: 'github' fetches via the site
      // cache (lazy refresh), 'manual' just reads the column.
      readme: showReadme ? await resolveReadme(c.env, row) : null,
      readme_updated_at: showReadme ? row.profile_readme_updated_at : null,
      readme_source: showReadme ? row.profile_readme_source : null,
    },
  });
});

async function resolveReadme(env: Env, row: UserRow): Promise<string | null> {
  if (row.profile_readme_source === "github") {
    let login: string | null = null;
    try {
      const meta = JSON.parse(row.profile_readme_source_meta ?? "{}") as {
        github_login?: string;
      };
      login = meta.github_login ?? null;
    } catch {
      // ignore — null login means no readme
    }
    if (!login) return null;
    return getGithubReadmeFromCache(env, row.id, login);
  }
  return row.profile_readme && row.profile_readme.length > 0
    ? row.profile_readme
    : null;
}

export default app;
