// Prism — OAuth Account Platform
// Cloudflare Worker entry point using Hono

import { runReverification } from "./cron/reverify";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getConfig } from "./lib/config";
import type { Variables } from "./types";

import initRoutes from "./routes/init";
import authRoutes from "./routes/auth";
import oauthRoutes from "./routes/oauth";
import appsRoutes from "./routes/apps";
import teamsRoutes from "./routes/teams";
import domainsRoutes from "./routes/domains";
import connectionsRoutes from "./routes/connections";
import userRoutes from "./routes/user";
import adminRoutes from "./routes/admin";
import proxyRoutes from "./routes/proxy";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use("*", secureHeaders());

app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const appUrl = c.env.APP_URL;
      if (!origin || origin === appUrl) return appUrl;
      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Token"],
  }),
);

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ ok: true }));

// ─── Public site config (for frontend) ───────────────────────────────────────

app.get("/api/site", async (c) => {
  const config = await getConfig(c.env.DB);
  return c.json({
    site_name: config.site_name,
    site_description: config.site_description,
    site_icon_url: config.site_icon_url,
    allow_registration: config.allow_registration,
    invite_only: config.invite_only,
    captcha_provider: config.captcha_provider,
    captcha_site_key: config.captcha_site_key,
    pow_difficulty: config.pow_difficulty,
    require_email_verification: config.require_email_verification,
    email_verify_methods: config.email_verify_methods,
    accent_color: config.accent_color,
    custom_css: config.custom_css,
    initialized: config.initialized,
    r2_enabled: !!c.env.R2_ASSETS,
    enabled_providers: await (async () => {
      // Prefer explicit oauth_sources rows; fall back to legacy site_config keys
      const { results } = await c.env.DB.prepare(
        "SELECT slug, name, provider FROM oauth_sources WHERE enabled = 1 ORDER BY created_at ASC",
      ).all<{ slug: string; name: string; provider: string }>();
      if (results.length > 0) return results;
      return (["github", "google", "microsoft", "discord"] as const)
        .filter(
          (p) =>
            !!(config as unknown as Record<string, string>)[`${p}_client_id`],
        )
        .map((p) => ({
          slug: p,
          name: p.charAt(0).toUpperCase() + p.slice(1),
          provider: p,
        }));
    })(),
  });
});

// R2 asset serving
app.get("/api/assets/*", async (c) => {
  if (!c.env.R2_ASSETS) return c.json({ error: "Not found" }, 404);
  const key = c.req.path.replace("/api/assets/", "");
  const obj = await c.env.R2_ASSETS.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { headers });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route("/api/init", initRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/oauth", oauthRoutes);
app.route("/api/apps", appsRoutes);
app.route("/api/teams", teamsRoutes);
app.route("/api/domains", domainsRoutes);
app.route("/api/connections", connectionsRoutes);
app.route("/api/user", userRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/proxy/image", proxyRoutes);

// OpenID Connect Discovery at root
app.get("/.well-known/openid-configuration", async (c) => {
  const base = c.env.APP_URL;
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    userinfo_endpoint: `${base}/api/oauth/userinfo`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    introspection_endpoint: `${base}/api/oauth/introspect`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: [
      "openid",
      "profile",
      "email",
      "apps:read",
      "offline_access",
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["HS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
  });
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  // Delegate to CF Assets, which will serve index.html for unknown paths
  // thanks to `not_found_handling: "single-page-application"` in wrangler.jsonc
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    return new Response(res.body, res);
  }
  return new Response(null, { status: 404 });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch.bind(app),

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReverification(env.DB));
  },

  // Cloudflare Email Worker — receives inbound emails for email-sending verification
  async email(
    message: EmailMessage & { setReject(reason: string): void },
    env: Env,
  ) {
    const to = message.to.toLowerCase();

    // Extract code from verify-<code>@domain
    const match = to.match(/^verify-([a-f0-9]+)@/);
    if (!match) {
      // Not a verification email — reject silently
      message.setReject("Unknown recipient");
      return;
    }

    const code = match[1];
    const senderEmail = message.from.toLowerCase();

    // Check if this is an admin test email
    const testKey = `email-receive-test:${code}`;
    const testVal = await env.KV_CACHE.get(testKey);
    if (testVal) {
      await env.KV_CACHE.delete(testKey);
      console.log(
        `[email-receive-test] Success — received from ${senderEmail}`,
      );
      return;
    }

    // Look up the user who owns this verify code and check sender matches
    const user = await env.DB.prepare(
      "SELECT id, email FROM users WHERE email_verify_code = ? AND email_verified = 0",
    )
      .bind(code)
      .first<{ id: string; email: string }>();

    if (!user) {
      message.setReject("Invalid verification code");
      return;
    }

    // The sender must match the user's registered email
    if (user.email.toLowerCase() !== senderEmail) {
      message.setReject("Sender does not match registered email");
      return;
    }

    // Mark email as verified
    await env.DB.prepare(
      "UPDATE users SET email_verified = 1, email_verify_code = NULL, email_verify_token = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(Math.floor(Date.now() / 1000), user.id)
      .run();
  },
};
