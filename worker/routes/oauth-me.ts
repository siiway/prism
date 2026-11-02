// OAuth-protected resource API: /api/oauth/me/*.
//
// Every route here authenticates with a bearer credential — an OAuth access
// token (opaque or JWT, optionally DPoP-bound) or a Personal Access Token —
// and authorizes by the scopes that credential carries.

import { Hono } from "hono";
import type { Context } from "hono";
import { configBag } from "../lib/config";
import { encryptSecret, hashLookupCandidate } from "../lib/secretCrypto";
import {
  findPersonalAccessToken,
  isExpired,
  touchPersonalAccessToken,
} from "../lib/personalAccessTokens";
import { getMLDSAKey } from "../lib/mldsa";
import { verifyAccessToken } from "../lib/jwt";
import { randomBase64url, randomId } from "../lib/crypto";
import { createDomain, parseDomainInput, verifyDomain } from "../lib/domains";
import { proxyImageUrl } from "../lib/proxyImage";
import { readPage, likePattern } from "../lib/pagination";
import { validateRedirectUriForRegistration } from "../lib/redirectUri";
import {
  guardCapability,
  hasLiveRestrictedAccounts,
  sanitizeRestrictedCapabilities,
} from "../lib/userCapabilities";
import {
  getGroupsForTeamMembers,
  getMemberGroups,
  sanitizeRolePermissions,
} from "../lib/teamGroups";
import { recordAccountDeletion, auditRequestMeta } from "../lib/audit";
import {
  getMember,
  getEffectiveMember,
  hasRole,
  ROLE_RANK,
  listEffectiveTeamMemberships,
  dissolveTeam,
} from "../lib/teams";
import type { DomainRow, OAuthAppRow, Variables } from "../types";
import { verifyDpopProof } from "../lib/dpop";
import { checkMemberAdd } from "../lib/teamRequirements";
import { REQUESTABLE_SCOPES } from "../lib/scopes";
import { challengeStepUp, deriveAcr } from "../lib/stepUp";
import { proxyUserAvatar } from "../lib/proxyImage";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Resource endpoints (OAuth-protected) ────────────────────────────────────

/** Validate Bearer token (OAuth access token or PAT) and check for a required scope.
 *
 *  After resolving the bearer's userId we verify the user row still exists,
 *  is_active=1, and kind='user'. This rejects tokens that outlived their
 *  user (deactivated/deleted) and refuses to act on behalf of any synthetic
 *  team-user row. Defense-in-depth — no token issuance flow creates tokens
 *  for kind='team' rows, but enforcing it here means a single misbehaving
 *  insert can't bypass the team-user invariant.
 */
async function resolveBearerToken(
  c: Context<AppEnv>,
  requiredScope: string,
  // RFC 9470: when set, the token's acr must satisfy this (an "mfa" token
  // satisfies a "pwd" requirement); otherwise a step-up challenge is issued.
  requiredAcr?: string,
): Promise<{
  userId: string;
  scopes: string[];
  clientId: string | null;
} | null> {
  // Accept either the Bearer or the DPoP (RFC 9449) authentication scheme.
  const authz = c.req.header("Authorization") ?? "";
  let scheme: "Bearer" | "DPoP";
  let raw: string;
  if (authz.startsWith("Bearer ")) {
    scheme = "Bearer";
    raw = authz.slice(7);
  } else if (authz.startsWith("DPoP ")) {
    scheme = "DPoP";
    raw = authz.slice(5);
  } else {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);

  let resolvedUserId: string;
  let resolvedScopes: string[];
  // Null when the credential is a PAT — those aren't tied to an OAuth app
  // and act directly as the user. Set to oauth_apps.client_id for JWT or
  // opaque OAuth access tokens so callers can apply per-grant policy.
  let resolvedClientId: string | null = null;
  // The DPoP key thumbprint the token is bound to, if any.
  let tokenJkt: string | null = null;
  // The token's authentication context class, for RFC 9470 step-up.
  let tokenAcr: string | null = null;

  // Personal Access Token (prism_pat_ prefix)
  if (raw.startsWith("prism_pat_")) {
    const pat = await findPersonalAccessToken(c.env, raw);
    if (!pat || isExpired(pat, now)) return null;
    if (!pat.scopes.includes(requiredScope)) return null;
    touchPersonalAccessToken(c.env, c.executionCtx, pat.id, now);
    resolvedUserId = pat.user_id;
    resolvedScopes = pat.scopes;
  } else if (raw.split(".").length === 3) {
    // JWT access token
    let payload;
    try {
      const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
      payload = verifyAccessToken(raw, mldsaKey.publicKey);
    } catch {
      return null;
    }
    // Revocation check: look up by jti (= oauth_tokens.id)
    const tokenRow = await c.env.DB.prepare(
      "SELECT user_id, scopes, expires_at, client_id, dpop_jkt FROM oauth_tokens WHERE id = ?",
    )
      .bind(payload.jti)
      .first<{
        user_id: string;
        scopes: string;
        expires_at: number;
        client_id: string;
        dpop_jkt: string | null;
      }>();
    if (!tokenRow || tokenRow.expires_at < now) return null;
    const scopes = JSON.parse(tokenRow.scopes) as string[];
    if (!scopes.includes(requiredScope)) return null;
    resolvedUserId = tokenRow.user_id;
    resolvedScopes = scopes;
    resolvedClientId = tokenRow.client_id;
    tokenJkt = payload.cnf?.jkt ?? tokenRow.dpop_jkt;
    tokenAcr = payload.acr ?? null;
  } else {
    // Legacy opaque access token (kept for backward compatibility)
    const accessLookup = await hashLookupCandidate(c.env, raw);
    if (!accessLookup) return null;
    const tokenRow = await c.env.DB.prepare(
      "SELECT user_id, scopes, expires_at, client_id, dpop_jkt, amr FROM oauth_tokens WHERE access_token = ? OR access_token = ?",
    )
      .bind(raw, accessLookup)
      .first<{
        user_id: string;
        scopes: string;
        expires_at: number;
        client_id: string;
        dpop_jkt: string | null;
        amr: string | null;
      }>();
    if (!tokenRow || tokenRow.expires_at < now) return null;
    const scopes = JSON.parse(tokenRow.scopes) as string[];
    if (!scopes.includes(requiredScope)) return null;
    resolvedUserId = tokenRow.user_id;
    resolvedScopes = scopes;
    resolvedClientId = tokenRow.client_id;
    tokenJkt = tokenRow.dpop_jkt;
    tokenAcr = tokenRow.amr ? deriveAcr(JSON.parse(tokenRow.amr)) : null;
  }

  // RFC 9449 §7.1: a DPoP-bound token is only valid with the DPoP scheme and a
  // matching proof; a bound token presented as plain Bearer is rejected, and
  // the DPoP scheme is refused for a token that carries no binding.
  if (tokenJkt) {
    if (scheme !== "DPoP") return null;
    const proof = c.req.header("DPoP");
    if (!proof) return null;
    const res = await verifyDpopProof(c.env, proof, {
      htm: c.req.method,
      htu: c.req.url,
      accessToken: raw,
    });
    if ("error" in res || res.jkt !== tokenJkt) return null;
  } else if (scheme === "DPoP") {
    return null;
  }

  // RFC 9470: enforce a required acr, issuing a step-up challenge when unmet.
  // An "mfa" token satisfies a "pwd" requirement, but not vice versa.
  if (requiredAcr) {
    const satisfied =
      tokenAcr === requiredAcr || (requiredAcr === "pwd" && tokenAcr === "mfa");
    if (!satisfied) {
      challengeStepUp(c, { acrValues: requiredAcr });
      return null;
    }
  }

  // Reject tokens whose user has been deactivated/deleted, and any
  // synthetic team-user (kind='team') that should never act on behalf
  // of itself via a bearer credential.
  const userRow = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND is_active = 1 AND kind = 'user'",
  )
    .bind(resolvedUserId)
    .first<{ id: string }>();
  if (!userRow) return null;

  return {
    userId: resolvedUserId,
    scopes: resolvedScopes,
    clientId: resolvedClientId,
  };
}

// GET /api/oauth/me/apps — list the token owner's OAuth apps (requires apps:read)
app.get("/me/apps", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, client_id, description, icon_url, website_url, is_public, is_active AS enabled, created_at
     FROM oauth_apps WHERE owner_id = ? AND team_id IS NULL ORDER BY created_at DESC`,
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      name: string;
      client_id: string;
      description: string | null;
      icon_url: string | null;
      website_url: string | null;
      is_public: number;
      enabled: number;
      created_at: number;
    }>();

  return c.json({
    apps: await Promise.all(
      results.map(async (a) => ({
        ...a,
        icon_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, a.icon_url),
        unproxied_icon_url: a.icon_url,
      })),
    ),
  });
});

// GET /api/oauth/me/teams — list the token owner's team memberships (requires
// teams:read). Includes both direct memberships and teams visible via
// sub-team inheritance (`inherited_from` carries the ancestor id).
app.get("/me/teams", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const memberships = await listEffectiveTeamMemberships(
    c.env.DB,
    resolved.userId,
  );
  memberships.sort((a, b) => b.joined_at - a.joined_at);

  return c.json({
    teams: await Promise.all(
      memberships.map(async (m) => ({
        id: m.team.id,
        name: m.team.name,
        description: m.team.description,
        avatar_url: await proxyImageUrl(
          c.env.APP_URL,
          c.env.DB,
          m.team.avatar_url,
        ),
        unproxied_avatar_url: m.team.avatar_url,
        parent_team_id: m.team.parent_team_id,
        created_at: m.team.created_at,
        role: m.role,
        joined_at: m.joined_at,
        inherited_from: m.inherited_from,
      })),
    ),
  });
});

// GET /api/oauth/me/domains — list the token owner's verified domains (requires domains:read)
app.get("/me/domains", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT domain, verified_at, next_reverify_at, created_at
     FROM domains
     WHERE user_id = ? AND team_id IS NULL AND verified = 1
     ORDER BY verified_at DESC`,
  )
    .bind(resolved.userId)
    .all<{
      domain: string;
      verified_at: number | null;
      next_reverify_at: number | null;
      created_at: number;
    }>();

  return c.json({ domains: results });
});

// GET /api/oauth/me/gpg-keys — list the token owner's GPG keys (requires gpg:read)
app.get("/me/gpg-keys", async (c) => {
  const resolved = await resolveBearerToken(c, "gpg:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, fingerprint, key_id, name, created_at, last_used_at FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      fingerprint: string;
      key_id: string;
      name: string;
      created_at: number;
      last_used_at: number | null;
    }>();

  return c.json({ keys: results });
});

// POST /api/oauth/me/gpg-keys — add a GPG key (requires gpg:write)
app.post("/me/gpg-keys", async (c) => {
  const resolved = await resolveBearerToken(c, "gpg:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);
  const capErr = await guardCapability(c.env.DB, resolved.userId, "gpg:manage");
  if (capErr) return c.json({ error: capErr }, 403);

  const { parseArmoredPublicKey } = await import("../lib/gpg");
  const body = await c.req.json<{ public_key: string; name?: string }>();
  if (!body.public_key)
    return c.json(
      { error: "field_required", params: { field: "public_key" } },
      400,
    );

  let parsed: Awaited<ReturnType<typeof parseArmoredPublicKey>>;
  try {
    parsed = await parseArmoredPublicKey(body.public_key);
  } catch {
    return c.json({ error: "pgp_key_invalid" }, 400);
  }

  const name = (body.name?.trim() || parsed.uids[0] || parsed.keyId).slice(
    0,
    128,
  );
  const existing = await c.env.DB.prepare(
    "SELECT id FROM user_gpg_keys WHERE user_id = ? AND fingerprint = ?",
  )
    .bind(resolved.userId, parsed.fingerprint)
    .first();
  if (existing) return c.json({ error: "key_exists" }, 409);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      resolved.userId,
      parsed.fingerprint,
      parsed.keyId,
      name,
      body.public_key.trim(),
      now,
    )
    .run();

  return c.json({
    id,
    fingerprint: parsed.fingerprint,
    key_id: parsed.keyId,
    name,
    created_at: now,
    last_used_at: null,
  });
});

// DELETE /api/oauth/me/gpg-keys/:id — remove a GPG key (requires gpg:write)
app.delete("/me/gpg-keys/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "gpg:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const result = await c.env.DB.prepare(
    "DELETE FROM user_gpg_keys WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .run();
  if (!result.meta.changes) return c.json({ error: "key_not_found" }, 404);
  return c.json({ ok: true });
});

// GET /api/oauth/me/social-connections — list the token owner's social connections (requires social:read)
app.get("/me/social-connections", async (c) => {
  const resolved = await resolveBearerToken(c, "social:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, provider, provider_user_id, profile_data, connected_at FROM social_connections WHERE user_id = ? ORDER BY connected_at ASC",
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      provider: string;
      provider_user_id: string;
      profile_data: string;
      connected_at: number;
    }>();

  return c.json({
    connections: results.map((r) => ({
      id: r.id,
      provider: r.provider,
      provider_user_id: r.provider_user_id,
      profile: JSON.parse(r.profile_data ?? "{}"),
      connected_at: r.connected_at,
    })),
  });
});

// DELETE /api/oauth/me/social-connections/:id — disconnect a social connection (requires social:write)
app.delete("/me/social-connections/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "social:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const result = await c.env.DB.prepare(
    "DELETE FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .run();
  if (!result.meta.changes)
    return c.json({ error: "connection_not_found" }, 404);
  return c.json({ ok: true });
});

// POST /api/oauth/me/teams — create a team (requires teams:create)
app.post("/me/teams", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:create");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);
  const capErr = await guardCapability(
    c.env.DB,
    resolved.userId,
    "team:create",
  );
  if (capErr) return c.json({ error: capErr }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
  }>();
  if (!body.name?.trim())
    return c.json({ error: "field_required", params: { field: "name" } }, 400);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO teams (id, name, description, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      body.name.trim(),
      body.description ?? "",
      body.avatar_url ?? null,
      now,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, resolved.userId, now),
  ]);

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first();

  return c.json({ team: { ...team, role: "owner" } }, 201);
});

// PATCH /api/oauth/me/teams/:id — update team settings (requires teams:write, owner or admin)
app.patch("/me/teams/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const effective = await getEffectiveMember(c.env.DB, teamId, resolved.userId);

  if (!effective || !["owner", "co-owner", "admin"].includes(effective.role))
    return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    avatar_url?: string;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description);
  }
  if (body.avatar_url !== undefined) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url || null);
  }

  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, teamId);

  await c.env.DB.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(teamId)
    .first();

  return c.json({ team });
});

// DELETE /api/oauth/me/teams/:id — delete a team (requires teams:delete, owner only).
// Effective owner counts — an inherited owner can disband a sub-team via OAuth,
// matching the session API. dissolveTeam handles the recursive cascade.
app.delete("/me/teams/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const effective = await getEffectiveMember(c.env.DB, teamId, resolved.userId);

  if (!effective || effective.role !== "owner")
    return c.json({ error: "team_owner_required" }, 403);

  // Same site-admin-only protection as the dashboard paths. Easiest of the
  // four to overlook and the most dangerous to miss: an authorized app can
  // reach this with no human present at all.
  if (await hasLiveRestrictedAccounts(c.env.DB, teamId))
    return c.json(
      {
        error: "team_dissolve_admin_only",
      },
      403,
    );

  // Recursive cascade — reassigns team-owned apps per level before deletion.
  await dissolveTeam(c.env.DB, teamId, resolved.userId);

  return c.json({ ok: true });
});

// POST /api/oauth/me/domains — add a domain for verification (requires domains:write)
app.post("/me/domains", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);
  const capErr = await guardCapability(
    c.env.DB,
    resolved.userId,
    "domain:create",
  );
  if (capErr) return c.json({ error: capErr }, 403);

  const body = await c.req.json<{ domain: string }>();
  if (!body.domain)
    return c.json(
      { error: "field_required", params: { field: "domain" } },
      400,
    );

  const domain = parseDomainInput(body.domain);
  if (!domain) return c.json({ error: "domain_invalid" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
  )
    .bind(resolved.userId, domain)
    .first();
  if (existing) return c.json({ error: "domain_exists" }, 409);

  const created = await createDomain(c.env.DB, {
    userId: resolved.userId,
    teamId: null,
    domain,
  });
  return c.json(created, 201);
});

// DELETE /api/oauth/me/domains/:domain — remove a domain (requires domains:write)
app.delete("/me/domains/:domain", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const domain = c.req.param("domain");
  const row = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
  )
    .bind(resolved.userId, domain)
    .first<{ id: string }>();

  if (!row) return c.json({ error: "domain_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(row.id).run();

  return c.json({ ok: true });
});

// POST /api/oauth/me/invites — create a site invite (requires admin:invites:create, admin only)
app.post("/me/invites", async (c) => {
  const resolved = await resolveBearerToken(c, "admin:invites:create");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();

  if (!user || user.role !== "admin")
    return c.json({ error: "admin_required" }, 403);

  const body = await c.req.json<{
    email?: string;
    note?: string;
    max_uses?: number;
    expires_in_days?: number;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const id = randomId();
  const token = randomBase64url(24);
  const storedToken = token;
  const expiresAt = body.expires_in_days
    ? now + body.expires_in_days * 86400
    : null;

  await c.env.DB.prepare(
    `INSERT INTO site_invites (id, token, email, note, max_uses, use_count, created_by, expires_at, created_at, enabled)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 1)`,
  )
    .bind(
      id,
      storedToken,
      body.email?.toLowerCase().trim() ?? null,
      body.note ?? null,
      body.max_uses ?? null,
      resolved.userId,
      expiresAt,
      now,
    )
    .run();

  const inviteUrl = `${c.env.APP_URL}/register?invite=${token}`;

  return c.json(
    { id, token, invite_url: inviteUrl, expires_at: expiresAt },
    201,
  );
});

// GET /api/oauth/me/invites — list site invites (requires admin:invites:read, admin only)
app.get("/me/invites", async (c) => {
  const resolved = await resolveBearerToken(c, "admin:invites:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();
  if (!user || user.role !== "admin")
    return c.json({ error: "admin_required" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.email, i.note, i.max_uses, i.use_count,
             i.created_by, i.expires_at, i.created_at, i.enabled,
            u.username AS created_by_username
     FROM site_invites i
     LEFT JOIN users u ON u.id = i.created_by
     ORDER BY i.created_at DESC`,
  ).all();

  return c.json({ invites: results });
});

// DELETE /api/oauth/me/invites/:id — revoke an invite (requires admin:invites:delete, admin only)
app.delete("/me/invites/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "admin:invites:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();
  if (!user || user.role !== "admin")
    return c.json({ error: "admin_required" }, 403);

  const invite = await c.env.DB.prepare(
    "SELECT id FROM site_invites WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!invite) return c.json({ error: "invite_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM site_invites WHERE id = ?")
    .bind(c.req.param("id"))
    .run();

  return c.json({ ok: true });
});

// GET /api/oauth/me/profile — read own profile (requires profile scope)
app.get("/me/profile", async (c) => {
  const resolved = await resolveBearerToken(c, "profile");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, created_at FROM users WHERE id = ?",
  )
    .bind(resolved.userId)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      email: string;
      email_verified: number;
      role: string;
      created_at: number;
    }>();

  if (!user) return c.json({ error: "user_not_found" }, 404);

  return c.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, user.avatar_url),
    unproxied_avatar_url: user.avatar_url,
    email: resolved.scopes.includes("email") ? user.email : undefined,
    email_verified: resolved.scopes.includes("email")
      ? user.email_verified === 1
      : undefined,
    role: user.role,
    created_at: user.created_at,
  });
});

// PATCH /api/oauth/me/profile — update own profile (requires profile:write)
app.patch("/me/profile", async (c) => {
  const resolved = await resolveBearerToken(c, "profile:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string | null;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    if (!body.display_name.trim())
      return c.json(
        { error: "field_empty", params: { field: "display_name" } },
        400,
      );
    updates.push("display_name = ?");
    values.push(body.display_name.trim());
  }
  if ("avatar_url" in body) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url ?? null);
  }

  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, resolved.userId);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, role FROM users WHERE id = ?",
  )
    .bind(resolved.userId)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      role: string;
    }>();

  return c.json({
    user: user
      ? {
          ...user,
          avatar_url: await proxyImageUrl(
            c.env.APP_URL,
            c.env.DB,
            user.avatar_url,
          ),
          unproxied_avatar_url: user.avatar_url,
        }
      : null,
  });
});

// POST /api/oauth/me/apps — create an OAuth app (requires apps:write)
app.post("/me/apps", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);
  const capErr = await guardCapability(c.env.DB, resolved.userId, "app:create");
  if (capErr) return c.json({ error: capErr }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    website_url?: string;
    redirect_uris: string[];
    allowed_scopes?: string[];
    is_public?: boolean;
  }>();

  if (!body.name?.trim())
    return c.json({ error: "field_required", params: { field: "name" } }, 400);
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0)
    return c.json({ error: "redirect_uri_required" }, 400);

  for (const uri of body.redirect_uris) {
    const reason = validateRedirectUriForRegistration(uri);
    if (reason)
      return c.json({ error: `redirect_uri_${reason}`, params: { uri } }, 400);
  }

  const allowedScopes = (
    body.allowed_scopes ?? ["openid", "profile", "email"]
  ).filter((s) => REQUESTABLE_SCOPES.has(s));

  const id = randomId();
  const clientId = `prism_${randomBase64url(16)}`;
  const clientSecret = randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO oauth_apps
       (id, owner_id, name, description, website_url, client_id, client_secret,
        redirect_uris, allowed_scopes, is_public, is_active, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      resolved.userId,
      body.name.trim(),
      body.description ?? "",
      body.website_url ?? null,
      clientId,
      // Encrypt at rest. Plaintext is returned in the response so the
      // calling app can store it; never re-fetched from D1 outside of
      // timingSafeSecretEqual.
      await encryptSecret(c.env, clientSecret),
      JSON.stringify(body.redirect_uris),
      JSON.stringify(allowedScopes),
      body.is_public ? 1 : 0,
      now,
      now,
    )
    .run();

  return c.json(
    {
      id,
      client_id: clientId,
      client_secret: clientSecret,
      name: body.name.trim(),
      description: body.description ?? "",
      website_url: body.website_url ?? null,
      redirect_uris: body.redirect_uris,
      allowed_scopes: allowedScopes,
      is_public: !!body.is_public,
      created_at: now,
    },
    201,
  );
});

/**
 * Resolve whether the calling token may manage an app via /me/apps endpoints.
 *
 * - Personal app (team_id IS NULL): caller must be the owner.
 * - Team app (team_id IS NOT NULL): caller must be a team owner or co-owner
 *   (admins can read but not grant — matches the consent-grant rule).
 */
async function canManageAppViaToken(
  db: D1Database,
  appId: string,
  callerUserId: string,
): Promise<{
  allowed: boolean;
  app: { id: string; owner_id: string; team_id: string | null } | null;
}> {
  const app = await db
    .prepare("SELECT id, owner_id, team_id FROM oauth_apps WHERE id = ?")
    .bind(appId)
    .first<{ id: string; owner_id: string; team_id: string | null }>();
  if (!app) return { allowed: false, app: null };

  if (!app.team_id) {
    return { allowed: app.owner_id === callerUserId, app };
  }

  // Effective role — an owner/co-owner of an ancestor team can manage the
  // sub-team-owned app (subject to the same role gate as direct membership).
  const effective = await getEffectiveMember(db, app.team_id, callerUserId);
  const role = effective?.role ?? "";
  return { allowed: role === "owner" || role === "co-owner", app };
}

// GET /api/oauth/me/team-apps — list OAuth apps owned by teams the token
// owner is a member of. Read-only listing — only owners/co-owners can grant
// or mutate via the PATCH/DELETE endpoints below. Requires apps:read.
app.get("/me/team-apps", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.client_id, a.description, a.icon_url,
            a.website_url, a.is_public, a.is_active, a.created_at, a.updated_at,
            a.team_id, t.name AS team_name, t.avatar_url AS team_avatar_url,
            tm.role AS my_role
     FROM oauth_apps a
     JOIN teams t ON t.id = a.team_id
     JOIN team_members tm ON tm.team_id = a.team_id AND tm.user_id = ?
     WHERE a.team_id IS NOT NULL
     ORDER BY a.created_at DESC`,
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      name: string;
      client_id: string;
      description: string | null;
      icon_url: string | null;
      website_url: string | null;
      is_public: number;
      is_active: number;
      created_at: number;
      updated_at: number;
      team_id: string;
      team_name: string;
      team_avatar_url: string | null;
      my_role: string;
    }>();

  return c.json({
    apps: await Promise.all(
      results.map(async (a) => ({
        ...a,
        icon_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, a.icon_url),
        unproxied_icon_url: a.icon_url,
        team_avatar_url: await proxyImageUrl(
          c.env.APP_URL,
          c.env.DB,
          a.team_avatar_url,
        ),
        unproxied_team_avatar_url: a.team_avatar_url,
        is_public: a.is_public === 1,
        is_active: a.is_active === 1,
        can_grant: a.my_role === "owner" || a.my_role === "co-owner",
      })),
    ),
  });
});

// PATCH /api/oauth/me/apps/:id — update own OAuth app (requires apps:write)
app.patch("/me/apps/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const appId = c.req.param("id");
  const access = await canManageAppViaToken(c.env.DB, appId, resolved.userId);

  if (!access.app) return c.json({ error: "app_not_found" }, 404);
  if (!access.allowed) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    website_url?: string | null;
    redirect_uris?: string[];
    allowed_scopes?: string[];
    is_public?: boolean;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description);
  }
  if ("website_url" in body) {
    updates.push("website_url = ?");
    values.push(body.website_url ?? null);
  }
  if (body.redirect_uris !== undefined) {
    for (const uri of body.redirect_uris) {
      const reason = validateRedirectUriForRegistration(uri);
      if (reason)
        return c.json(
          { error: `redirect_uri_${reason}`, params: { uri } },
          400,
        );
    }
    updates.push("redirect_uris = ?");
    values.push(JSON.stringify(body.redirect_uris));
  }
  if (body.allowed_scopes !== undefined) {
    updates.push("allowed_scopes = ?");
    values.push(
      JSON.stringify(
        body.allowed_scopes.filter((s) => REQUESTABLE_SCOPES.has(s)),
      ),
    );
  }
  if (body.is_public !== undefined) {
    updates.push("is_public = ?");
    values.push(body.is_public ? 1 : 0);
  }

  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, appId);

  await c.env.DB.prepare(
    `UPDATE oauth_apps SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ?",
  )
    .bind(appId)
    .first<OAuthAppRow>();

  const {
    client_secret: clientSecret,
    registration_access_token: registrationAccessToken,
    ...appWithoutSecrets
  } = updated!;
  return c.json({
    app: {
      ...appWithoutSecrets,
      has_client_secret: clientSecret.length > 0,
      has_registration_access_token: registrationAccessToken !== null,
    },
  });
});

// DELETE /api/oauth/me/apps/:id — delete own OAuth app (requires apps:write)
app.delete("/me/apps/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const appId = c.req.param("id");
  const access = await canManageAppViaToken(c.env.DB, appId, resolved.userId);

  if (!access.app) return c.json({ error: "app_not_found" }, 404);
  if (!access.allowed) return c.json({ error: "forbidden" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE client_id = (SELECT client_id FROM oauth_apps WHERE id = ?)",
    ).bind(appId),
    c.env.DB.prepare(
      "DELETE FROM oauth_consents WHERE client_id = (SELECT client_id FROM oauth_apps WHERE id = ?)",
    ).bind(appId),
    c.env.DB.prepare("DELETE FROM oauth_apps WHERE id = ?").bind(appId),
  ]);

  return c.json({ ok: true });
});

// POST /api/oauth/me/domains/:domain/verify — trigger DNS re-check (requires domains:write)
app.post("/me/domains/:domain/verify", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
  )
    .bind(resolved.userId, c.req.param("domain"))
    .first<DomainRow>();

  if (!row) return c.json({ error: "domain_not_found" }, 404);
  if (row.verified === 1) return c.json({ verified: true });

  // Over this API a domain is proved by its DNS TXT record (or a verified
  // parent domain), so the answer stays a plain verified / not-found.
  const outcome = await verifyDomain(c.env.DB, row, "dns-txt");
  if (!outcome.verified)
    return c.json({ error: "txt_record_not_found", verified: false }, 422);
  return c.json({ verified: true, verified_at: outcome.verified_at });
});

// POST /api/oauth/me/teams/:id/members — add a team member (requires teams:write, owner or admin)
app.post("/me/teams/:id/members", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const caller = await getEffectiveMember(c.env.DB, teamId, resolved.userId);

  if (!caller || !["owner", "admin"].includes(caller.role))
    return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    username: string;
    role?: "admin" | "member";
  }>();
  if (!body.username)
    return c.json(
      { error: "field_required", params: { field: "username" } },
      400,
    );

  const targetUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ? AND is_active = 1 AND kind = 'user'",
  )
    .bind(body.username.toLowerCase().trim())
    .first<{ id: string }>();

  if (!targetUser) return c.json({ error: "user_not_found" }, 404);

  const alreadyMember = await c.env.DB.prepare(
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, targetUser.id)
    .first();

  if (alreadyMember) return c.json({ error: "already_member" }, 409);

  const gate = await checkMemberAdd(c.env.DB, teamId, targetUser.id, false);
  if (!gate.ok)
    return c.json(
      { error: gate.error, unmet_requirements: gate.unmet_requirements },
      403,
    );

  // Only owners can add admins
  const role =
    body.role === "admin" && caller.role === "owner" ? "admin" : "member";
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
  )
    .bind(teamId, targetUser.id, role, now)
    .run();

  return c.json({ user_id: targetUser.id, role, joined_at: now }, 201);
});

// DELETE /api/oauth/me/teams/:id/members/:userId — remove a team member (requires teams:write, owner or admin)
app.delete("/me/teams/:id/members/:userId", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const caller = await getEffectiveMember(c.env.DB, teamId, resolved.userId);

  if (!caller || !["owner", "admin"].includes(caller.role))
    return c.json({ error: "forbidden" }, 403);

  const target = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, targetUserId)
    .first<{ role: string }>();

  if (!target) return c.json({ error: "member_not_found" }, 404);

  // Admins cannot remove owners or other admins
  if (caller.role === "admin" && target.role !== "member")
    return c.json({ error: "admin_can_only_remove_members" }, 403);

  // Owners cannot remove themselves via this endpoint
  if (targetUserId === resolved.userId && target.role === "owner")
    return c.json({ error: "owner_cannot_leave" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, targetUserId)
    .run();

  return c.json({ ok: true });
});

// ─── Admin resource endpoints (token owner must have role = 'admin') ─────────

/** Ensure the token owner is a site admin. Returns the user row or null. */
async function requireAdminToken(
  c: Context<AppEnv>,
  requiredScope: string,
): Promise<{ userId: string; scopes: string[] } | null> {
  const resolved = await resolveBearerToken(c, requiredScope);
  if (!resolved) return null;
  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();
  if (!user || user.role !== "admin") return null;
  return resolved;
}

// The /me/admin/* and /me/site/* user endpoints are one feature reached
// through two scope families — the older admin:users:* set and the site:user:*
// set. Only the demanded scope differs, so both share these handlers instead
// of being kept in sync by hand.
const USER_COLUMNS =
  "id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at";

function listUsersByScope(requiredScope: string) {
  return async (c: Context<AppEnv>) => {
    const resolved = await requireAdminToken(c, requiredScope);
    if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

    const { page, limit, offset } = readPage(
      c.req.query("page"),
      c.req.query("limit"),
      50,
      100,
    );
    const q = c.req.query("q");
    const where = q
      ? `WHERE (username LIKE ? ESCAPE '\\'
                OR email LIKE ? ESCAPE '\\'
                OR display_name LIKE ? ESCAPE '\\')`
      : "";
    const filterBinds = q ? Array<string>(3).fill(likePattern(q)) : [];

    const { results } = await c.env.DB.prepare(
      `SELECT ${USER_COLUMNS} FROM users ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...filterBinds, limit, offset)
      .all();

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM users ${where}`,
    )
      .bind(...filterBinds)
      .first<{ total: number }>();

    return c.json({
      users: await Promise.all(
        results.map((u) => proxyUserAvatar(c.env.APP_URL, c.env.DB, u)),
      ),
      total: countRow?.total ?? 0,
      page,
      limit,
    });
  };
}

function getUserByScope(requiredScope: string) {
  return async (c: Context<AppEnv>) => {
    const resolved = await requireAdminToken(c, requiredScope);
    if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

    const user = await c.env.DB.prepare(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
    )
      .bind(c.req.param("id"))
      .first();

    if (!user) return c.json({ error: "user_not_found" }, 404);
    return c.json({
      user: await proxyUserAvatar(c.env.APP_URL, c.env.DB, user),
    });
  };
}

// GET /api/oauth/me/admin/users — list all users (requires admin:users:read)
app.get("/me/admin/users", listUsersByScope("admin:users:read"));

// GET /api/oauth/me/admin/users/:id — get a user by id (requires admin:users:read)
app.get("/me/admin/users/:id", getUserByScope("admin:users:read"));

// PATCH /api/oauth/me/admin/users/:id — update a user (requires admin:users:write)
app.patch("/me/admin/users/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:users:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const targetId = c.req.param("id");
  const body = await c.req.json<{
    role?: "admin" | "user";
    is_active?: boolean;
    display_name?: string;
    avatar_url?: string | null;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.role !== undefined && ["admin", "user"].includes(body.role)) {
    updates.push("role = ?");
    values.push(body.role);
  }
  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (body.display_name !== undefined) {
    updates.push("display_name = ?");
    values.push(body.display_name.trim());
  }
  if ("avatar_url" in body) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url ?? null);
  }

  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, targetId);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at FROM users WHERE id = ?",
  )
    .bind(targetId)
    .first();

  return c.json({
    user: user ? await proxyUserAvatar(c.env.APP_URL, c.env.DB, user) : null,
  });
});

// DELETE /api/oauth/me/admin/users/:id — delete a user (requires admin:users:delete)
app.delete("/me/admin/users/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:users:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const targetId = c.req.param("id");

  if (targetId === resolved.userId)
    return c.json({ error: "cannot_delete_self" }, 403);

  const target = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?",
  )
    .bind(targetId)
    .first<{ id: string; username: string }>();
  if (!target) return c.json({ error: "user_not_found" }, 404);

  // This path emitted nothing at all before. Fan out before the delete so
  // the teams the user belonged to are still readable.
  await recordAccountDeletion(
    c.env,
    c.executionCtx,
    { id: target.id, username: target.username },
    {
      actorId: resolved.userId,
      cause: "admin",
      ...auditRequestMeta(c),
    },
  );

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").bind(
      targetId,
    ),
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE user_id = ?").bind(
      targetId,
    ),
    c.env.DB.prepare("DELETE FROM team_members WHERE user_id = ?").bind(
      targetId,
    ),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId),
  ]);

  return c.json({ ok: true });
});

// GET /api/oauth/me/site/users — list all users (requires site:user:read, token owner must be admin)
app.get("/me/site/users", listUsersByScope("site:user:read"));

// GET /api/oauth/me/site/users/:id — get a user by id (requires site:user:read, token owner must be admin)
app.get("/me/site/users/:id", getUserByScope("site:user:read"));

// ─── Team-scoped OAuth routes ─────────────────────────────────────────────────
// All routes below require a bound team scope: team:<teamId>:<permission>

async function resolveTeamToken(
  c: Context<AppEnv>,
  teamId: string,
  permission: string,
): Promise<{
  userId: string;
  scopes: string[];
  clientId: string | null;
} | null> {
  return resolveBearerToken(c, `team:${teamId}:${permission}`);
}

/**
 * Effective team role for a bearer credential acting on a team:
 *   • PAT (clientId === null) — the user IS the actor, return their own
 *     team role
 *   • OAuth access token — the actor is the *app*; cap by the most-recent
 *     grantor's CURRENT team_members.role. Demote/kick the grantor and
 *     the app's effective rights drop with them.
 *
 * Returns null if there is no membership row to anchor the action on.
 */
async function effectiveTeamRole(
  db: D1Database,
  teamId: string,
  resolved: { userId: string; clientId: string | null },
): Promise<string | null> {
  if (resolved.clientId === null) {
    const member = await getMember(db, teamId, resolved.userId);
    return member?.role ?? null;
  }
  const grant = await db
    .prepare(
      "SELECT grantor_user_id FROM team_scope_grants WHERE client_id = ? AND team_id = ? ORDER BY granted_at DESC LIMIT 1",
    )
    .bind(resolved.clientId, teamId)
    .first<{ grantor_user_id: string }>();
  if (!grant) return null;
  const member = await getMember(db, teamId, grant.grantor_user_id);
  return member?.role ?? null;
}

// GET /api/oauth/me/team/:teamId/info
app.get("/me/team/:teamId/info", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const team = await c.env.DB.prepare(
    "SELECT id, name, description, avatar_url, created_at FROM teams WHERE id = ?",
  )
    .bind(teamId)
    .first<{
      id: string;
      name: string;
      description: string | null;
      avatar_url: string | null;
      created_at: number;
    }>();

  if (!team) return c.json({ error: "team_not_found" }, 404);
  return c.json({
    team: {
      ...team,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
    },
  });
});

// PATCH /api/oauth/me/team/:teamId/info
app.patch("/me/team/:teamId/info", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    avatar_url?: string | null;
  }>();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description ?? null);
  }
  if ("avatar_url" in body) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url ?? null);
  }

  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  const now = Math.floor(Date.now() / 1000);
  updates.push("updated_at = ?");
  values.push(now, teamId);

  await c.env.DB.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const team = await c.env.DB.prepare(
    "SELECT id, name, description, avatar_url, created_at FROM teams WHERE id = ?",
  )
    .bind(teamId)
    .first();

  return c.json({ team });
});

// GET /api/oauth/me/team/:teamId/members
app.get("/me/team/:teamId/members", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "member:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  // Require the actor to still hold a member-or-above role in the team.
  // For OAuth tokens this is capped by the grantor's current role (see
  // effectiveTeamRole); demote/kick the grantor and the read right drops.
  const actorRole = await effectiveTeamRole(c.env.DB, teamId, resolved);
  if (!actorRole || !hasRole(actorRole, "member"))
    return c.json({ error: "actor_not_team_member" }, 403);

  const team = await c.env.DB.prepare(
    "SELECT restrict_member_list_for_members FROM teams WHERE id = ?",
  )
    .bind(teamId)
    .first<{ restrict_member_list_for_members: number }>();

  let memberFilter = "";
  const filterArgs: unknown[] = [teamId];
  if (team?.restrict_member_list_for_members === 1 && actorRole === "member") {
    memberFilter =
      " AND (tm.role IN ('owner', 'co-owner', 'admin') OR tm.user_id = ?)";
    filterArgs.push(resolved.userId);
  }

  const [{ results }, groups] = await Promise.all([
    c.env.DB.prepare(
      `SELECT tm.user_id, tm.role, tm.joined_at
     FROM team_members tm WHERE tm.team_id = ?${memberFilter} ORDER BY tm.joined_at ASC`,
    )
      .bind(...filterArgs)
      .all<{ user_id: string; role: string; joined_at: number }>(),
    // Empty for every member when the team has groups switched off.
    getGroupsForTeamMembers(c.env.DB, teamId),
  ]);

  return c.json({
    members: results.map((m) => ({
      ...m,
      groups: groups.get(m.user_id) ?? [],
    })),
  });
});

// GET /api/oauth/me/team/:teamId/members/:userId/profile
app.get("/me/team/:teamId/members/:userId/profile", async (c) => {
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const resolved = await resolveTeamToken(c, teamId, "member:profile:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const actorRole = await effectiveTeamRole(c.env.DB, teamId, resolved);
  if (!actorRole || !hasRole(actorRole, "member"))
    return c.json({ error: "actor_not_team_member" }, 403);

  const team = await c.env.DB.prepare(
    "SELECT restrict_member_list_for_members FROM teams WHERE id = ?",
  )
    .bind(teamId)
    .first<{ restrict_member_list_for_members: number }>();

  let visibilityFilter = "";
  const filterArgs: unknown[] = [teamId, userId];
  if (team?.restrict_member_list_for_members === 1 && actorRole === "member") {
    visibilityFilter =
      " AND (tm.role IN ('owner', 'co-owner', 'admin') OR tm.user_id = ?)";
    filterArgs.push(resolved.userId);
  }

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, tm.role, tm.joined_at
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.user_id = ?${visibilityFilter}`,
  )
    .bind(...filterArgs)
    .first<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      role: string;
      joined_at: number;
    }>();

  if (!row) return c.json({ error: "member_not_found" }, 404);
  return c.json({
    member: {
      ...row,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, row.avatar_url),
      unproxied_avatar_url: row.avatar_url,
      groups: await getMemberGroups(c.env.DB, teamId, userId),
    },
  });
});

// POST /api/oauth/me/team/:teamId/members
app.post("/me/team/:teamId/members", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "member:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{ user_id: string; role?: string }>();
  if (!body.user_id)
    return c.json(
      { error: "field_required", params: { field: "user_id" } },
      400,
    );

  const role = body.role === "admin" ? "admin" : "member";

  // Cap by the actor's effective team role — see effectiveTeamRole.
  // Without this, an app holding `team:<id>:member:write` could promote
  // a colluding user to admin even though the granting member never had
  // owner-level rights.
  const actorRole = await effectiveTeamRole(c.env.DB, teamId, resolved);
  if (!actorRole || !hasRole(actorRole, "admin"))
    return c.json({ error: "actor_not_team_admin" }, 403);
  if (role === "admin" && !hasRole(actorRole, "owner"))
    return c.json({ error: "team_owner_required" }, 403);

  const now = Math.floor(Date.now() / 1000);
  const target = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND is_active = 1 AND kind = 'user'",
  )
    .bind(body.user_id)
    .first();
  if (!target) return c.json({ error: "user_not_found" }, 404);
  if (await getMember(c.env.DB, teamId, body.user_id))
    return c.json({ error: "already_member" }, 409);

  const gate = await checkMemberAdd(c.env.DB, teamId, body.user_id, false);
  if (!gate.ok)
    return c.json(
      { error: gate.error, unmet_requirements: gate.unmet_requirements },
      403,
    );

  await c.env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
  )
    .bind(teamId, body.user_id, role, now)
    .run();

  return c.json({ user_id: body.user_id, role });
});

// PATCH /api/oauth/me/team/:teamId/members/:userId/role
app.patch("/me/team/:teamId/members/:userId/role", async (c) => {
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const resolved = await resolveTeamToken(c, teamId, "member:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{ role: string }>();
  const allowed = ["member", "admin", "co-owner"];
  if (!allowed.includes(body.role))
    return c.json({ error: "role_invalid" }, 400);

  const target = await getMember(c.env.DB, teamId, userId);
  if (!target) return c.json({ error: "member_not_found" }, 404);

  // Mirror the dashboard guards in worker/routes/teams.ts so an app with
  // `team:<id>:member:write` can never escalate beyond what the granting
  // user could do at the dashboard.
  if (target.role === "owner")
    return c.json({ error: "cannot_change_owner_role" }, 403);
  const actorRole = await effectiveTeamRole(c.env.DB, teamId, resolved);
  if (!actorRole || !hasRole(actorRole, "admin"))
    return c.json({ error: "actor_not_team_admin" }, 403);
  if (target.role === "co-owner" && actorRole !== "owner")
    return c.json({ error: "team_owner_required" }, 403);
  if (body.role === "co-owner" && actorRole !== "owner")
    return c.json({ error: "team_owner_required" }, 403);
  if ((ROLE_RANK[body.role] ?? 0) >= (ROLE_RANK[actorRole] ?? 0))
    return c.json({ error: "role_above_own" }, 403);

  await c.env.DB.prepare(
    "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.role, teamId, userId)
    .run();

  return c.json({ user_id: userId, role: body.role });
});

// DELETE /api/oauth/me/team/:teamId/members/:userId
app.delete("/me/team/:teamId/members/:userId", async (c) => {
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const resolved = await resolveTeamToken(c, teamId, "member:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const target = await getMember(c.env.DB, teamId, userId);
  if (!target) return c.json({ error: "member_not_found" }, 404);

  // The dashboard refuses to remove the team owner; OAuth must too,
  // otherwise an app with member:write can leave the team ownerless.
  if (target.role === "owner")
    return c.json({ error: "cannot_remove_owner" }, 403);
  const actorRole = await effectiveTeamRole(c.env.DB, teamId, resolved);
  if (!actorRole || !hasRole(actorRole, "admin"))
    return c.json({ error: "actor_not_team_admin" }, 403);
  if (target.role === "co-owner" && actorRole !== "owner")
    return c.json({ error: "team_owner_required" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, userId)
    .run();

  return c.json({ ok: true });
});

// GET /api/oauth/me/admin/config — read site config (requires admin:config:read)
app.get("/me/admin/config", async (c) => {
  const resolved = await requireAdminToken(c, "admin:config:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { getConfig } = await import("../lib/config");
  const config = await getConfig(c.env.DB);

  // Strip sensitive credential fields
  const SENSITIVE_KEYS = [
    "github_client_secret",
    "google_client_secret",
    "microsoft_client_secret",
    "discord_client_secret",
    "captcha_secret_key",
    "turnstile_secret_key",
    "turnstile_china_secret_key",
    "hcaptcha_secret_key",
    "recaptcha_secret_key",
    "geetest_captcha_key",
    "cap_secret_key",
    "smtp_password",
    "email_api_key",
  ];
  const safe = Object.fromEntries(
    Object.entries(configBag(config)).filter(
      ([k]) => !SENSITIVE_KEYS.includes(k),
    ),
  );

  return c.json({ config: safe });
});

// PATCH /api/oauth/me/admin/config — update site config (requires admin:config:write)
app.patch("/me/admin/config", async (c) => {
  const resolved = await requireAdminToken(c, "admin:config:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<Record<string, unknown>>();

  // Disallow updating sensitive credential fields via this endpoint
  const BLOCKED = new Set([
    "github_client_id",
    "github_client_secret",
    "google_client_id",
    "google_client_secret",
    "microsoft_client_id",
    "microsoft_client_secret",
    "discord_client_id",
    "discord_client_secret",
    "captcha_secret_key",
    "turnstile_secret_key",
    "turnstile_china_secret_key",
    "hcaptcha_secret_key",
    "recaptcha_secret_key",
    "geetest_captcha_key",
    "cap_secret_key",
    "smtp_password",
    "email_api_key",
    "initialized",
  ]);

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!BLOCKED.has(k)) updates[k] = v;
  }

  // This endpoint is deny-listed rather than allow-listed, so the capability
  // set has to be sanitised here too — otherwise arbitrary JSON reaches the
  // config row through this path.
  if (updates.default_team_role_permissions !== undefined) {
    updates.default_team_role_permissions = sanitizeRolePermissions(
      updates.default_team_role_permissions,
    );
  }
  if (updates.restricted_user_capabilities !== undefined) {
    updates.restricted_user_capabilities = sanitizeRestrictedCapabilities(
      updates.restricted_user_capabilities,
    );
  }

  if (Object.keys(updates).length === 0)
    return c.json({ error: "nothing_to_update" }, 400);

  const { setConfigValues } = await import("../lib/config");
  await setConfigValues(c.env.DB, updates);

  return c.json({ updated: Object.keys(updates) });
});

export default app;
