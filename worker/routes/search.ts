// Search for the command palette: one request that looks up everything the
// signed-in user can open by name, instead of one request per list page.
//
//   GET /api/search?q=<text>
//
// Returns up to RESULT_LIMIT matches per kind, in one D1 batch:
// - everyone: their apps (own and their teams'), teams, domains, personal
//   access tokens and the apps they have authorized;
// - admins, in addition: every user, team, app, domain and OAuth source.
//   Admins skip the personal app/team/domain lookups, which the site-wide
//   ones already cover.
//
// Matching is a case-insensitive substring match, as on the list pages.

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { likePattern } from "../lib/pagination";
import type { Variables } from "../types";
import { listEffectiveTeamMemberships } from "./teams";

const RESULT_LIMIT = 5;
const MIN_QUERY = 2;
const MAX_QUERY = 100;

export type SearchKind =
  "app" | "team" | "domain" | "token" | "consent" | "user" | "oauth_source";

export interface SearchHit {
  kind: SearchKind;
  /** Site-wide (admin) result rather than one of the user's own. */
  admin: boolean;
  id: string;
  title: string;
  subtitle: string | null;
  /** In-app path to open it. */
  url: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", requireAuth);

app.get("/", async (c) => {
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length < MIN_QUERY) return c.json({ results: [] as SearchHit[] });

  const like = likePattern(q);
  const isAdmin = user.role === "admin";
  const db = c.env.DB;
  const ci = "LOWER(?) ESCAPE '\\'";

  type Lookup = {
    kind: SearchKind;
    admin: boolean;
    sql: string;
    args: unknown[];
    map: (row: Record<string, unknown>) => Omit<SearchHit, "kind" | "admin">;
  };
  const str = (v: unknown) => (v == null ? null : String(v));

  const lookups: Lookup[] = [];

  // Teams the user can open: direct memberships plus, when the site has
  // membership inheritance on, every sub-team of those (the same set the
  // team list shows). Their names are matched here; their apps in SQL.
  const ownTeams: SearchHit[] = [];
  let effectiveTeamIds: string[] = [];
  if (!isAdmin) {
    const memberships = await listEffectiveTeamMemberships(db, user.id);
    effectiveTeamIds = memberships.map((m) => m.team.id);
    const needle = q.toLowerCase();
    ownTeams.push(
      ...memberships
        .filter((m) => m.team.name.toLowerCase().includes(needle))
        .sort((a, b) => b.team.created_at - a.team.created_at)
        .slice(0, RESULT_LIMIT)
        .map((m) => ({
          kind: "team" as const,
          admin: false,
          id: m.team.id,
          title: m.team.name,
          subtitle: null,
          url: `/teams/${m.team.id}`,
        })),
    );
  }

  if (!isAdmin) {
    lookups.push(
      {
        kind: "app",
        admin: false,
        // Team ids go in as one JSON array (json_each), so a user in many
        // teams can't exceed the bound-parameter limit.
        sql: `SELECT a.id, a.name, a.client_id FROM oauth_apps a
              WHERE ((a.owner_id = ? AND a.team_id IS NULL)
                     OR a.team_id IN (SELECT value FROM json_each(?)))
                AND (LOWER(a.name) LIKE ${ci} OR LOWER(a.client_id) LIKE ${ci})
              ORDER BY a.created_at DESC LIMIT ?`,
        args: [
          user.id,
          JSON.stringify(effectiveTeamIds),
          like,
          like,
          RESULT_LIMIT,
        ],
        map: (r) => ({
          id: String(r.id),
          title: String(r.name),
          subtitle: str(r.client_id),
          url: `/apps/${r.id}`,
        }),
      },
      {
        kind: "domain",
        admin: false,
        sql: `SELECT id, domain FROM domains
              WHERE user_id = ? AND LOWER(domain) LIKE ${ci}
              ORDER BY created_at DESC LIMIT ?`,
        args: [user.id, like, RESULT_LIMIT],
        map: (r) => ({
          id: String(r.id),
          title: String(r.domain),
          subtitle: null,
          url: "/domains",
        }),
      },
    );
  }

  lookups.push(
    {
      kind: "token",
      admin: false,
      sql: `SELECT id, name FROM personal_access_tokens
            WHERE user_id = ? AND LOWER(name) LIKE ${ci}
            ORDER BY created_at DESC LIMIT ?`,
      args: [user.id, like, RESULT_LIMIT],
      map: (r) => ({
        id: String(r.id),
        title: String(r.name),
        subtitle: null,
        url: "/tokens",
      }),
    },
    {
      kind: "consent",
      admin: false,
      sql: `SELECT oc.client_id, oa.name FROM oauth_consents oc
            JOIN oauth_apps oa ON oa.client_id = oc.client_id
            WHERE oc.user_id = ? AND LOWER(oa.name) LIKE ${ci}
            ORDER BY oc.granted_at DESC LIMIT ?`,
      args: [user.id, like, RESULT_LIMIT],
      map: (r) => ({
        id: String(r.client_id),
        title: String(r.name),
        subtitle: null,
        url: "/connected-apps",
      }),
    },
  );

  if (isAdmin) {
    lookups.push(
      {
        kind: "user",
        admin: true,
        sql: `SELECT id, username, display_name, email FROM users
              WHERE kind = 'user'
                AND (LOWER(username) LIKE ${ci} OR LOWER(display_name) LIKE ${ci}
                     OR LOWER(email) LIKE ${ci})
              ORDER BY created_at DESC LIMIT ?`,
        args: [like, like, like, RESULT_LIMIT],
        map: (r) => ({
          id: String(r.id),
          title: String(r.display_name || r.username),
          subtitle: [`@${r.username}`, r.email].filter(Boolean).join(" · "),
          url: `/admin/users/${r.id}`,
        }),
      },
      {
        kind: "team",
        admin: true,
        sql: `SELECT id, name FROM teams
              WHERE LOWER(name) LIKE ${ci}
              ORDER BY created_at DESC LIMIT ?`,
        args: [like, RESULT_LIMIT],
        map: (r) => ({
          id: String(r.id),
          title: String(r.name),
          subtitle: null,
          url: `/teams/${r.id}`,
        }),
      },
      {
        kind: "app",
        admin: true,
        sql: `SELECT id, name, client_id FROM oauth_apps
              WHERE LOWER(name) LIKE ${ci} OR LOWER(client_id) LIKE ${ci}
              ORDER BY created_at DESC LIMIT ?`,
        args: [like, like, RESULT_LIMIT],
        map: (r) => ({
          id: String(r.id),
          title: String(r.name),
          subtitle: str(r.client_id),
          url: `/apps/${r.id}`,
        }),
      },
      {
        kind: "domain",
        admin: true,
        sql: `SELECT d.id, d.domain, u.username AS owner_username, t.name AS team_name
              FROM domains d
              LEFT JOIN users u ON u.id = d.user_id
              LEFT JOIN teams t ON t.id = d.team_id
              WHERE LOWER(d.domain) LIKE ${ci}
              ORDER BY d.created_at DESC LIMIT ?`,
        args: [like, RESULT_LIMIT],
        map: (r) => ({
          id: String(r.id),
          title: String(r.domain),
          subtitle: r.owner_username
            ? `@${r.owner_username}`
            : str(r.team_name),
          url: "/admin/domains",
        }),
      },
      {
        kind: "oauth_source",
        admin: true,
        sql: `SELECT id, name, slug FROM oauth_sources
              WHERE LOWER(name) LIKE ${ci} OR LOWER(slug) LIKE ${ci}
              ORDER BY created_at DESC LIMIT ?`,
        args: [like, like, RESULT_LIMIT],
        map: (r) => ({
          id: String(r.id),
          title: String(r.name),
          subtitle: str(r.slug),
          url: "/admin/connections",
        }),
      },
    );
  }

  const batches = await db.batch(
    lookups.map((l) => db.prepare(l.sql).bind(...l.args)),
  );
  const results: SearchHit[] = lookups.flatMap((l, i) =>
    (batches[i].results as Record<string, unknown>[]).map((row) => ({
      kind: l.kind,
      admin: l.admin,
      ...l.map(row),
    })),
  );
  return c.json({ results: [...ownTeams, ...results] });
});

export default app;
