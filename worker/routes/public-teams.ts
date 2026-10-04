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
  const showSubTeams =
    config.enable_sub_teams &&
    resolve(
      team.profile_show_sub_teams,
      config.default_team_profile_show_sub_teams,
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
  // If team member hiding is enabled, regular members are never exposed here.
  const masterDefault = config.default_profile_show_joined_teams ? 1 : 0;
  const hideRegularMembers = team.restrict_member_list_for_members === 1;
  const membersPromise = showMembers
    ? c.env.DB.prepare(
        `SELECT u.username, u.display_name, u.avatar_url, tm.role
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ?
           AND u.is_active = 1
           AND u.profile_is_public = 1
           ${hideRegularMembers ? "AND tm.role IN ('owner', 'co-owner', 'admin')" : ""}
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

  // Public sub-team listing — surfaces only children that have themselves
  // opted in to a public profile. We don't want a private sub-team's name
  // leaked just because the parent is public.
  const subTeamsPromise = showSubTeams
    ? c.env.DB.prepare(
        `SELECT id, name, avatar_url, (
           SELECT COUNT(*) FROM team_members WHERE team_id = t.id
         ) AS member_count
         FROM teams t
         WHERE t.parent_team_id = ? AND t.profile_is_public = 1
         ORDER BY t.created_at DESC`,
      )
        .bind(team.id)
        .all<{
          id: string;
          name: string;
          avatar_url: string | null;
          member_count: number;
        }>()
    : Promise.resolve(null);

  // Parent breadcrumb — show only when the parent is itself a public team
  // (parent_team_id may exist but point at a private team; we treat that
  // as "no parent" for public-facing purposes).
  const parentPromise = team.parent_team_id
    ? c.env.DB.prepare(
        `SELECT id, name, avatar_url, profile_is_public
         FROM teams WHERE id = ? LIMIT 1`,
      )
        .bind(team.parent_team_id)
        .first<{
          id: string;
          name: string;
          avatar_url: string | null;
          profile_is_public: number;
        }>()
    : Promise.resolve(null);

  const [owner, memberCountRow, apps, domains, members, subTeams, parent] =
    await Promise.all([
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
      subTeamsPromise,
      parentPromise,
    ]);

  return c.json({
    team: {
      id: team.id,
      name: team.name,
      description: showDescription ? team.description : null,
      avatar_url: showAvatar
        ? await proxyImageUrl(c.env.APP_URL, c.env.DB, team.avatar_url)
        : null,
      unproxied_avatar_url: showAvatar ? team.avatar_url : null,
      created_at: team.created_at,
      owner:
        owner && owner.profile_is_public === 1
          ? {
              username: owner.username,
              display_name: owner.display_name,
              avatar_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                owner.avatar_url,
              ),
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
      apps: apps
        ? await Promise.all(
            apps.results.map(async (a) => ({
              id: a.id,
              client_id: a.client_id,
              name: a.name,
              description: a.description,
              icon_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                a.icon_url,
              ),
              website_url: a.website_url,
              created_at: a.created_at,
            })),
          )
        : null,
      domains:
        domains?.results.map((d) => ({
          domain: d.domain,
          verified_at: d.verified_at,
        })) ?? null,
      members: members
        ? await Promise.all(
            members.results.map(async (m) => ({
              username: m.username,
              display_name: m.display_name,
              avatar_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                m.avatar_url,
              ),
              role: m.role,
            })),
          )
        : null,
      sub_teams: subTeams
        ? await Promise.all(
            subTeams.results.map(async (s) => ({
              id: s.id,
              name: s.name,
              avatar_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                s.avatar_url,
              ),
              member_count: s.member_count,
            })),
          )
        : null,
      parent_team:
        parent && parent.profile_is_public === 1
          ? {
              id: parent.id,
              name: parent.name,
              avatar_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                parent.avatar_url,
              ),
            }
          : null,
    },
  });
});

export default app;
