// Public-facing team profile lookup. Mirrors the user public-profile route
// in worker/routes/users.ts: gated by site config + per-team opt-in, with
// per-section visibility flags that fall back to site defaults. 404 is the
// only response for missing/private teams to avoid leaking team IDs.

import { Hono } from "hono";
import { optionalAuth } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { proxyImageUrl } from "../lib/proxyImage";
import type { TeamRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.get("/:id", optionalAuth, async (c) => {
  const teamId = c.req.param("id") ?? "";
  if (!teamId) return c.json({ error: "Not found" }, 404);
  const config = await getConfig(c.env.DB);
  // The user-public-profile master switch also gates team profiles, so an
  // admin can disable the whole feature with one toggle.
  if (!config.enable_public_profiles) {
    return c.json({ error: "Not found" }, 404);
  }

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(teamId)
    .first<TeamRow>();

  // A team member viewing their own team is allowed to see the profile even
  // when it's still private — powers the "preview public profile" link in
  // team settings.
  const viewer = c.get("user");
  let viewerIsMember = false;
  if (viewer && team) {
    const m = await c.env.DB.prepare(
      "SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?",
    )
      .bind(team.id, viewer.id)
      .first<{ x: number }>();
    viewerIsMember = !!m;
  }

  if (!team || (!team.profile_is_public && !viewerIsMember)) {
    return c.json({ error: "Not found" }, 404);
  }

  const resolve = (v: number | null, def: boolean): boolean =>
    v === null ? def : v === 1;

  const showDescription = resolve(
    team.profile_show_description,
    config.default_team_profile_show_description,
  );
  const showAvatar = resolve(
    team.profile_show_avatar,
    config.default_team_profile_show_avatar,
  );
  const showOwner = resolve(
    team.profile_show_owner,
    config.default_team_profile_show_owner,
  );
  const showMemberCount = resolve(
    team.profile_show_member_count,
    config.default_team_profile_show_member_count,
  );
  const showApps = resolve(
    team.profile_show_apps,
    config.default_team_profile_show_apps,
  );
  const showDomains = resolve(
    team.profile_show_domains,
    config.default_team_profile_show_domains,
  );
  const showMembers = resolve(
    team.profile_show_members,
    config.default_team_profile_show_members,
  );

  // Team owners get surfaced by username only — and only if their own
  // user public profile is public, so an opted-out user isn't accidentally
  // outed via a team page they happen to own.
  const ownerPromise = showOwner
    ? c.env.DB.prepare(
        `SELECT u.username, u.display_name, u.avatar_url, u.profile_is_public
         FROM team_members tm JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ? AND tm.role = 'owner'
         LIMIT 1`,
      )
        .bind(team.id)
        .first<{
          username: string;
          display_name: string;
          avatar_url: string | null;
          profile_is_public: number;
        }>()
    : Promise.resolve(null);

  // Members section. We compute "effective show_on_profile" the same way
  // the user's own joined-teams query does:
  //   (per-team override = 1) OR (per-team override IS NULL AND user master
  //                              flag resolves to true)
  // The user master flag itself falls back to the site default
  // (default_profile_show_joined_teams) when NULL.
  const masterDefault = config.default_profile_show_joined_teams ? 1 : 0;
  const membersPromise = showMembers
    ? c.env.DB.prepare(
        `SELECT u.username, u.display_name, u.avatar_url, tm.role
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ?
           AND u.is_active = 1
           AND u.profile_is_public = 1
           AND (
             tm.show_on_profile = 1
             OR (
               tm.show_on_profile IS NULL
               AND COALESCE(u.profile_show_joined_teams, ?) = 1
             )
           )
         ORDER BY
           CASE tm.role WHEN 'owner' THEN 0 WHEN 'co-owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
           tm.joined_at ASC`,
      )
        .bind(team.id, masterDefault)
        .all<{
          username: string;
          display_name: string;
          avatar_url: string | null;
          role: string;
        }>()
    : Promise.resolve(null);

  const [owner, memberCountRow, apps, domains, members] = await Promise.all([
    ownerPromise,
    showMemberCount
      ? c.env.DB.prepare(
          "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
        )
          .bind(team.id)
          .first<{ n: number }>()
      : Promise.resolve(null),
    showApps
      ? c.env.DB.prepare(
          `SELECT id, client_id, name, description, icon_url, website_url, created_at
           FROM oauth_apps
           WHERE team_id = ? AND is_active = 1
           ORDER BY created_at ASC`,
        )
          .bind(team.id)
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
           WHERE team_id = ? AND verified = 1
           ORDER BY verified_at ASC`,
        )
          .bind(team.id)
          .all<{ domain: string; verified_at: number | null }>()
      : Promise.resolve(null),
    membersPromise,
  ]);

  return c.json({
    team: {
      id: team.id,
      name: team.name,
      description: showDescription ? team.description : null,
      avatar_url: showAvatar
        ? proxyImageUrl(c.env.APP_URL, team.avatar_url)
        : null,
      unproxied_avatar_url: showAvatar ? team.avatar_url : null,
      created_at: team.created_at,
      owner:
        owner && owner.profile_is_public === 1
          ? {
              username: owner.username,
              display_name: owner.display_name,
              avatar_url: proxyImageUrl(c.env.APP_URL, owner.avatar_url),
            }
          : owner
            ? // Owner exists but their user profile is private — surface
              // only their display name with no avatar/handle. This way the
              // team can show "run by Alice" without exposing a profile
              // link the owner hasn't opted into.
              {
                username: null,
                display_name: owner.display_name,
                avatar_url: null,
              }
            : null,
      member_count: memberCountRow?.n ?? null,
      apps:
        apps?.results.map((a) => ({
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
      members:
        members?.results.map((m) => ({
          username: m.username,
          display_name: m.display_name,
          avatar_url: proxyImageUrl(c.env.APP_URL, m.avatar_url),
          role: m.role,
        })) ?? null,
    },
  });
});

export default app;
