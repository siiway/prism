// Lists shown on public user and team profiles. Both profiles show the same
// app card and verified-domain list, only scoped to a different owner.

import type { DomainOwner } from "./domains";
import { proxyImageUrl } from "./proxyImage";

/** The owner's active apps, oldest first, with icons proxied. */
export async function listPublicApps(env: Env, owner: DomainOwner) {
  const [where, id] =
    "teamId" in owner
      ? ["team_id = ?", owner.teamId]
      : ["owner_id = ? AND team_id IS NULL", owner.userId];
  const { results } = await env.DB.prepare(
    `SELECT id, client_id, name, description, icon_url, website_url, created_at
       FROM oauth_apps
      WHERE ${where} AND is_active = 1
      ORDER BY created_at ASC`,
  )
    .bind(id)
    .all<{
      id: string;
      client_id: string;
      name: string;
      description: string;
      icon_url: string | null;
      website_url: string | null;
      created_at: number;
    }>();
  return Promise.all(
    results.map(async (a) => ({
      ...a,
      icon_url: await proxyImageUrl(env.APP_URL, env.DB, a.icon_url),
    })),
  );
}

/** The owner's verified domains, in the order they were verified. */
export async function listPublicDomains(db: D1Database, owner: DomainOwner) {
  const [where, id] =
    "teamId" in owner
      ? ["team_id = ?", owner.teamId]
      : ["user_id = ? AND team_id IS NULL", owner.userId];
  const { results } = await db
    .prepare(
      `SELECT domain, verified_at
         FROM domains
        WHERE ${where} AND verified = 1
        ORDER BY verified_at ASC`,
    )
    .bind(id)
    .all<{ domain: string; verified_at: number | null }>();
  return results;
}
