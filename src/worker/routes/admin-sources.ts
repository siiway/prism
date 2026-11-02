// Admin → OAuth sources: the external identity providers people can sign in
// with, OIDC discovery for configuring one, and the migration of legacy
// site_config credentials into oauth_sources.

import { Hono } from "hono";
import { configBag, getConfig } from "../lib/config";
import { encryptSecret } from "../lib/secretCrypto";
import { readPage, likePattern } from "../lib/pagination";
import { randomId } from "../lib/crypto";
import { auditAdmin } from "../lib/audit";
import type { OAuthSourceRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── OAuth Sources ─────────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set([
  "github",
  "google",
  "microsoft",
  "discord",
  "telegram",
  "x",
  "cloudflare",
  "oidc",
  "oauth2",
]);
const GENERIC_PROVIDERS = new Set(["oidc", "oauth2"]);

const LEGACY_PROVIDER_KEYS = [
  { slug: "github", provider: "github", name: "GitHub" },
  { slug: "google", provider: "google", name: "Google" },
  { slug: "microsoft", provider: "microsoft", name: "Microsoft" },
  { slug: "discord", provider: "discord", name: "Discord" },
] as const;

app.get("/oauth-sources", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "LOWER(name || ' ' || slug) LIKE LOWER(?) ESCAPE '\\'"
    : "1 = 1";
  const args: unknown[] = query ? [likePattern(query)] : [];

  const [{ results }, config, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, slug, provider, name, enabled, created_at, auth_url, token_url, userinfo_url, scopes, issuer_url, icon_url, show_icon, icon_only, trusted
       FROM oauth_sources WHERE ${where}
       ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<Omit<OAuthSourceRow, "client_id" | "client_secret">>(),
    getConfig(c.env.DB),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM oauth_sources WHERE ${where}`)
      .bind(...args)
      .first<{ n: number }>(),
  ]);

  const existingSlugs = new Set(results.map((r) => r.slug));
  const cfg = configBag(config);
  const legacy_providers = LEGACY_PROVIDER_KEYS.filter(
    (p) => !!cfg[`${p.slug}_client_id`] && !existingSlugs.has(p.slug),
  ).map((p) => p.slug);

  return c.json({
    sources: results,
    legacy_providers,
    total: countRow?.n ?? 0,
    page,
    limit,
  });
});

// ─── OIDC Discovery ───────────────────────────────────────────────────────────

app.get("/oauth-sources/discover", async (c) => {
  const issuer = c.req.query("issuer");
  if (!issuer)
    return c.json(
      { error: "field_required", params: { field: "issuer" } },
      400,
    );

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    return c.json({ error: "issuer_url_invalid" }, 400);
  }

  // Canonical discovery document path per OpenID Connect Discovery 1.0
  const base = issuer.replace(/\/$/, "");
  const discoveryUrl = `${base}/.well-known/openid-configuration`;

  let doc: Record<string, unknown>;
  try {
    const res = await fetch(discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok)
      return c.json(
        { error: "discovery_http_error", params: { status: res.status } },
        502,
      );
    doc = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return c.json(
      {
        error: "discovery_fetch_failed",
        params: { detail: err instanceof Error ? err.message : String(err) },
      },
      502,
    );
  }

  const auth_url = doc.authorization_endpoint as string | undefined;
  const token_url = doc.token_endpoint as string | undefined;
  const userinfo_url = doc.userinfo_endpoint as string | undefined;

  if (!auth_url || !token_url || !userinfo_url)
    return c.json(
      {
        error: "discovery_incomplete",
      },
      422,
    );

  return c.json({ auth_url, token_url, userinfo_url });
});

// ─── Migrate legacy site_config OAuth credentials to oauth_sources ─────────────

// One source, without its credentials. Registered after /discover so that
// path isn't read as an id.
app.get("/oauth-sources/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, slug, provider, name, enabled, created_at, auth_url, token_url, userinfo_url, scopes, issuer_url, icon_url, show_icon, icon_only, trusted
     FROM oauth_sources WHERE id = ?`,
  )
    .bind(c.req.param("id"))
    .first<Omit<OAuthSourceRow, "client_id" | "client_secret">>();
  if (!row) return c.json({ error: "source_not_found" }, 404);
  return c.json({ source: row });
});

app.post("/oauth-sources/migrate", async (c) => {
  const config = await getConfig(c.env.DB);
  const migrated: string[] = [];
  const skipped: string[] = [];

  const cfg = configBag(config);
  for (const { slug, provider, name } of LEGACY_PROVIDER_KEYS) {
    const clientId = cfg[`${slug}_client_id`] as string;
    const clientSecret = cfg[`${slug}_client_secret`] as string;

    if (!clientId) continue;

    const existing = await c.env.DB.prepare(
      "SELECT id FROM oauth_sources WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (existing) {
      skipped.push(slug);
      continue;
    }

    const id = randomId();
    const now = Math.floor(Date.now() / 1000);
    // The legacy site_config value MAY already be encrypted (admins who
    // ran the SECRETS_KEY migration before adding sources). encryptSecret
    // is idempotent on encrypted input, so we always send through.
    await c.env.DB.prepare(
      "INSERT INTO oauth_sources (id, slug, provider, name, client_id, client_secret, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
      .bind(
        id,
        slug,
        provider,
        name,
        clientId,
        await encryptSecret(c.env, clientSecret ?? ""),
        now,
      )
      .run();

    migrated.push(slug);
  }

  return c.json({ migrated, skipped });
});

app.post("/oauth-sources", async (c) => {
  const body = await c.req.json<{
    slug: string;
    provider: string;
    name: string;
    client_id: string;
    client_secret: string;
    auth_url?: string;
    token_url?: string;
    userinfo_url?: string;
    scopes?: string;
    issuer_url?: string;
    icon_url?: string;
    show_icon?: boolean;
    icon_only?: 0 | 1 | 2;
    trusted?: boolean;
  }>();

  if (
    !body.slug ||
    !body.provider ||
    !body.name ||
    !body.client_id ||
    !body.client_secret
  )
    return c.json(
      {
        error: "fields_required",
        params: { fields: "slug, provider, name, client_id, client_secret" },
      },
      400,
    );

  if (!VALID_PROVIDERS.has(body.provider))
    return c.json(
      {
        error: "field_one_of",
        params: { field: "provider", values: [...VALID_PROVIDERS].join(", ") },
      },
      400,
    );

  if (!/^[a-z0-9-]{1,64}$/.test(body.slug))
    return c.json(
      {
        error: "slug_invalid",
      },
      400,
    );

  if (GENERIC_PROVIDERS.has(body.provider)) {
    if (!body.auth_url || !body.token_url || !body.userinfo_url)
      return c.json(
        {
          error: "generic_provider_urls_required",
        },
        400,
      );
  }

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  try {
    // icon_only is a 0|1|2 enum; clamp anything else to 0 so a bad value
    // can't poison the row.
    const iconOnlyInt =
      body.icon_only === 1 || body.icon_only === 2 ? body.icon_only : 0;
    await c.env.DB.prepare(
      "INSERT INTO oauth_sources (id, slug, provider, name, client_id, client_secret, enabled, created_at, auth_url, token_url, userinfo_url, scopes, issuer_url, icon_url, show_icon, icon_only, trusted) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        body.slug,
        body.provider,
        body.name,
        body.client_id,
        await encryptSecret(c.env, body.client_secret),
        now,
        body.auth_url ?? null,
        body.token_url ?? null,
        body.userinfo_url ?? null,
        body.scopes ?? null,
        body.issuer_url ?? null,
        body.icon_url ?? null,
        body.show_icon === false ? 0 : 1,
        iconOnlyInt,
        body.trusted === false ? 0 : 1,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE"))
      return c.json({ error: "source_slug_taken" }, 409);
    throw err;
  }

  auditAdmin(
    c,
    "oauth_source.create",
    "oauth_source",
    id,
    { slug: body.slug, provider: body.provider },
    body.slug,
  );
  return c.json(
    {
      source: {
        id,
        slug: body.slug,
        provider: body.provider,
        name: body.name,
        enabled: 1,
      },
    },
    201,
  );
});

app.patch("/oauth-sources/:id", async (c) => {
  const { id } = c.req.param();

  const existing = await c.env.DB.prepare(
    "SELECT id, slug FROM oauth_sources WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; slug: string }>();
  if (!existing) return c.json({ error: "source_not_found" }, 404);

  const body = await c.req.json<{
    name?: string;
    client_id?: string;
    client_secret?: string;
    enabled?: boolean;
    auth_url?: string;
    token_url?: string;
    userinfo_url?: string;
    scopes?: string;
    issuer_url?: string;
    icon_url?: string;
    show_icon?: boolean;
    icon_only?: 0 | 1 | 2;
    trusted?: boolean;
  }>();

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    vals.push(body.name);
  }
  if (body.client_id !== undefined) {
    sets.push("client_id = ?");
    vals.push(body.client_id);
  }
  if (body.client_secret !== undefined) {
    sets.push("client_secret = ?");
    vals.push(await encryptSecret(c.env, body.client_secret));
  }
  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(body.enabled ? 1 : 0);
  }
  if (body.auth_url !== undefined) {
    sets.push("auth_url = ?");
    vals.push(body.auth_url || null);
  }
  if (body.token_url !== undefined) {
    sets.push("token_url = ?");
    vals.push(body.token_url || null);
  }
  if (body.userinfo_url !== undefined) {
    sets.push("userinfo_url = ?");
    vals.push(body.userinfo_url || null);
  }
  if (body.scopes !== undefined) {
    sets.push("scopes = ?");
    vals.push(body.scopes || null);
  }
  if (body.issuer_url !== undefined) {
    sets.push("issuer_url = ?");
    vals.push(body.issuer_url || null);
  }
  if (body.icon_url !== undefined) {
    sets.push("icon_url = ?");
    vals.push(body.icon_url || null);
  }
  if (body.show_icon !== undefined) {
    sets.push("show_icon = ?");
    vals.push(body.show_icon ? 1 : 0);
  }
  if (body.icon_only !== undefined) {
    sets.push("icon_only = ?");
    vals.push(
      body.icon_only === 1 || body.icon_only === 2 ? body.icon_only : 0,
    );
  }
  if (body.trusted !== undefined) {
    sets.push("trusted = ?");
    vals.push(body.trusted ? 1 : 0);
  }

  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  vals.push(id);
  await c.env.DB.prepare(
    `UPDATE oauth_sources SET ${sets.join(", ")} WHERE id = ?`,
  )
    .bind(...vals)
    .run();

  auditAdmin(c, "oauth_source.update", "oauth_source", id, {}, existing.slug);
  return c.json({ ok: true });
});

app.delete("/oauth-sources/:id", async (c) => {
  const { id } = c.req.param();

  const existing = await c.env.DB.prepare(
    "SELECT slug FROM oauth_sources WHERE id = ?",
  )
    .bind(id)
    .first<{ slug: string }>();
  if (!existing) return c.json({ error: "source_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM oauth_sources WHERE id = ?")
    .bind(id)
    .run();
  auditAdmin(
    c,
    "oauth_source.delete",
    "oauth_source",
    id,
    { slug: existing.slug },
    existing.slug,
  );
  return c.json({ ok: true });
});

export default app;
