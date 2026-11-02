// Dynamic Client Registration (RFC 7591) and its management protocol
// (RFC 7592): /api/oauth/register.

import { Hono } from "hono";
import type { Context } from "hono";
import {
  encryptSecret,
  hashSecret,
  hashLookupCandidate,
  timingSafeSecretEqual,
} from "../lib/secretCrypto";
import { randomBase64url, randomId } from "../lib/crypto";
import { requireAuth, tryPatAuth } from "../middleware/auth";
import {
  parseRedirectUris,
  validateRedirectUriForRegistration,
} from "../lib/redirectUri";
import { parseAppScope } from "../lib/scopes";
import type { OAuthAppRow, Variables } from "../types";
import { validateOutboundUrl } from "../lib/safeFetch";
import {
  DEVICE_GRANT_TYPE,
  TOKEN_EXCHANGE_GRANT_TYPE,
} from "../lib/oauthClients";
import { REQUESTABLE_SCOPES } from "../lib/scopes";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Dynamic Client Registration (RFC 7591 / 7592) ───────────────────────────

// The grant/response types every registered client may use here.
const DCR_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
  DEVICE_GRANT_TYPE,
  TOKEN_EXCHANGE_GRANT_TYPE,
];

/** Keep only scopes this server recognises (platform scopes or an `app:*`
 *  delegation form); default to the OIDC basics when none are requested. */
function filterDcrScopes(scope: string | undefined): string[] {
  const requested = (scope ?? "openid profile email")
    .split(" ")
    .filter(Boolean);
  return requested.filter(
    (s) => REQUESTABLE_SCOPES.has(s) || parseAppScope(s) !== null,
  );
}

/** Build the non-secret RFC 7591 §3.2.1 client information for `app`.
 *  Fresh credentials are added only by the registration handler that minted
 *  them; RFC 7592 read/update responses must not recover stored secrets. */
function buildClientInfoDoc(
  env: Env,
  app: OAuthAppRow,
  regToken: string | null,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    client_id: app.client_id,
    client_id_issued_at: app.created_at,
    client_name: app.name,
    redirect_uris: parseRedirectUris(app.redirect_uris).map((r) => r.value),
    grant_types: DCR_GRANT_TYPES,
    response_types: ["code"],
    token_endpoint_auth_method:
      app.token_endpoint_auth_method ??
      (app.is_public ? "none" : "client_secret_basic"),
    scope: (JSON.parse(app.allowed_scopes) as string[]).join(" "),
    registration_client_uri: `${env.APP_URL}/api/oauth/register/${app.client_id}`,
  };
  if (app.website_url) doc.client_uri = app.website_url;
  if (app.icon_url) doc.logo_uri = app.icon_url;
  const postLogout = JSON.parse(
    app.post_logout_redirect_uris ?? "[]",
  ) as string[];
  if (postLogout.length) doc.post_logout_redirect_uris = postLogout;
  if (app.jwks_uri) doc.jwks_uri = app.jwks_uri;
  if (app.jwks) {
    try {
      doc.jwks = JSON.parse(app.jwks);
    } catch {
      /* omit malformed */
    }
  }
  if (app.backchannel_logout_uri)
    doc.backchannel_logout_uri = app.backchannel_logout_uri;
  if (regToken) doc.registration_access_token = regToken;
  return doc;
}

/** RFC 7591 client metadata accepted at registration and update. */
interface DcrMetadata {
  redirect_uris?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  token_endpoint_auth_method?: string;
  post_logout_redirect_uris?: string[];
  jwks?: unknown;
  jwks_uri?: string;
  backchannel_logout_uri?: string;
}

/** Validate + normalise the mutable parts of a registration request. Returns an
 *  RFC 7591 error (code + English error_description, which is for client
 *  developers and never shown in Prism's UI) or the
 *  normalised values. */
function normaliseDcrMetadata(body: DcrMetadata):
  | {
      description: string;
      code: "invalid_redirect_uri" | "invalid_client_metadata";
    }
  | {
      redirectUris: { type: "equals"; value: string }[];
      isPublic: number;
      authMethod: string;
      scopes: string[];
      postLogout: string[];
      jwks: string | null;
      jwksUri: string | null;
      backchannelLogoutUri: string | null;
    } {
  const redirectUris: { type: "equals"; value: string }[] = [];
  for (const uri of body.redirect_uris ?? []) {
    const reason = validateRedirectUriForRegistration(uri);
    if (reason)
      return {
        description: `Invalid redirect_uri: ${uri} (${reason})`,
        code: "invalid_redirect_uri",
      };
    redirectUris.push({ type: "equals", value: uri });
  }

  const authMethod = body.token_endpoint_auth_method ?? "client_secret_basic";
  const validMethods = [
    "none",
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
  ];
  if (!validMethods.includes(authMethod))
    return {
      description: `Unsupported token_endpoint_auth_method: ${authMethod}`,
      code: "invalid_client_metadata",
    };

  let jwks: string | null = null;
  if (body.jwks !== undefined) {
    try {
      jwks = JSON.stringify(body.jwks);
    } catch {
      return { description: "Invalid jwks", code: "invalid_client_metadata" };
    }
  }
  const jwksUri = typeof body.jwks_uri === "string" ? body.jwks_uri : null;
  if (jwksUri && validateOutboundUrl(jwksUri))
    return { description: "Invalid jwks_uri", code: "invalid_client_metadata" };

  if (authMethod === "private_key_jwt" && !jwks && !jwksUri)
    return {
      description: "private_key_jwt requires jwks or jwks_uri",
      code: "invalid_client_metadata",
    };

  const postLogout: string[] = [];
  for (const u of body.post_logout_redirect_uris ?? []) {
    try {
      const parsed = new URL(u);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.hash)
        throw new Error("bad");
      postLogout.push(u);
    } catch {
      return {
        description: `Invalid post_logout_redirect_uri: ${u}`,
        code: "invalid_client_metadata",
      };
    }
  }

  let backchannelLogoutUri: string | null = null;
  if (
    typeof body.backchannel_logout_uri === "string" &&
    body.backchannel_logout_uri
  ) {
    if (validateOutboundUrl(body.backchannel_logout_uri))
      return {
        description: "Invalid backchannel_logout_uri",
        code: "invalid_client_metadata",
      };
    backchannelLogoutUri = body.backchannel_logout_uri;
  }

  return {
    redirectUris,
    isPublic: authMethod === "none" ? 1 : 0,
    authMethod,
    scopes: filterDcrScopes(body.scope),
    postLogout,
    jwks,
    jwksUri,
    backchannelLogoutUri,
  };
}

// POST /api/oauth/register — create a client (RFC 7591). Gated: the caller must
// be a signed-in user or a PAT with apps:write (the "initial access token").
app.post(
  "/register",
  tryPatAuth({ read: "apps:read", write: "apps:write" }),
  requireAuth,
  async (c) => {
    const user = c.get("user");
    const body = await c.req
      .json<DcrMetadata>()
      .catch(() => ({}) as DcrMetadata);

    const norm = normaliseDcrMetadata(body);
    if ("description" in norm)
      return c.json(
        { error: norm.code, error_description: norm.description },
        400,
      );

    const id = randomId();
    const clientId = `prism_${randomBase64url(16)}`;
    const clientSecretPlain = norm.isPublic ? "" : randomBase64url(32);
    const regToken = `reg_${randomBase64url(24)}`;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(
      `INSERT INTO oauth_apps
         (id, owner_id, name, description, website_url, icon_url, client_id, client_secret,
          redirect_uris, allowed_scopes, optional_scopes, oidc_fields, is_public, is_active, is_verified,
          post_logout_redirect_uris, registration_access_token, token_endpoint_auth_method, jwks, jwks_uri,
          backchannel_logout_uri, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, '[]', '[]', ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        body.client_name ?? "Dynamic Client",
        body.client_uri ?? null,
        body.logo_uri ?? null,
        clientId,
        clientSecretPlain ? await encryptSecret(c.env, clientSecretPlain) : "",
        JSON.stringify(norm.redirectUris),
        JSON.stringify(norm.scopes),
        norm.isPublic,
        JSON.stringify(norm.postLogout),
        await hashSecret(c.env, regToken),
        norm.authMethod,
        norm.jwks,
        norm.jwksUri,
        norm.backchannelLogoutUri,
        now,
        now,
      )
      .run();

    const app = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
      .bind(id)
      .first<OAuthAppRow>();
    const doc = buildClientInfoDoc(c.env, app!, regToken);
    // This creation response is the only time the generated client secret is
    // disclosed. Subsequent RFC 7592 GET/PUT responses contain metadata only.
    if (!norm.isPublic) {
      doc.client_secret = clientSecretPlain;
      doc.client_secret_expires_at = 0; // never expires
    }
    return c.json(doc, 201);
  },
);

/** Authenticate an RFC 7592 management request: Bearer <registration_access_token>
 *  matching the app addressed by :client_id. */
async function authRegistrationAccess(
  c: Context<AppEnv>,
  clientId: string,
): Promise<OAuthAppRow | null> {
  const authz = c.req.header("Authorization");
  if (!authz?.startsWith("Bearer ")) return null;
  const token = authz.slice(7);
  const app = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(clientId)
    .first<OAuthAppRow>();
  if (!app || !app.registration_access_token) return null;
  const lookup = await hashLookupCandidate(c.env, token);
  const matches =
    (await timingSafeSecretEqual(
      c.env,
      app.registration_access_token,
      token,
    )) ||
    (lookup !== null && app.registration_access_token === lookup);
  return matches ? app : null;
}

// GET /api/oauth/register/:client_id — read client config (RFC 7592).
app.get("/register/:client_id", async (c) => {
  const app = await authRegistrationAccess(c, c.req.param("client_id"));
  if (!app) return c.json({ error: "invalid_token" }, 401);
  return c.json(buildClientInfoDoc(c.env, app, null));
});

// PUT /api/oauth/register/:client_id — update client config (RFC 7592).
app.put("/register/:client_id", async (c) => {
  const app = await authRegistrationAccess(c, c.req.param("client_id"));
  if (!app) return c.json({ error: "invalid_token" }, 401);
  const body = await c.req.json<DcrMetadata>().catch(() => ({}) as DcrMetadata);
  const norm = normaliseDcrMetadata(body);
  if ("description" in norm)
    return c.json(
      { error: norm.code, error_description: norm.description },
      400,
    );

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `UPDATE oauth_apps
        SET name = ?, website_url = ?, icon_url = ?, redirect_uris = ?,
            allowed_scopes = ?, is_public = ?, post_logout_redirect_uris = ?,
            token_endpoint_auth_method = ?, jwks = ?, jwks_uri = ?,
            backchannel_logout_uri = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      body.client_name ?? app.name,
      body.client_uri !== undefined ? body.client_uri : app.website_url,
      body.logo_uri !== undefined ? body.logo_uri : app.icon_url,
      JSON.stringify(norm.redirectUris),
      JSON.stringify(norm.scopes),
      norm.isPublic,
      JSON.stringify(norm.postLogout),
      norm.authMethod,
      norm.jwks,
      norm.jwksUri,
      norm.backchannelLogoutUri,
      now,
      app.id,
    )
    .run();
  const updated = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ?",
  )
    .bind(app.id)
    .first<OAuthAppRow>();
  return c.json(buildClientInfoDoc(c.env, updated!, null));
});

// DELETE /api/oauth/register/:client_id — deregister the client (RFC 7592).
app.delete("/register/:client_id", async (c) => {
  const app = await authRegistrationAccess(c, c.req.param("client_id"));
  if (!app) return c.json({ error: "invalid_token" }, 401);
  await c.env.DB.prepare("DELETE FROM oauth_apps WHERE id = ?")
    .bind(app.id)
    .run();
  return new Response(null, { status: 204 });
});

export default app;
