// Public site config and health endpoints

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { proxyImageUrl } from "../lib/proxyImage";
import type { Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/site", async (c) => {
  const config = await getConfig(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT slug, name, provider FROM oauth_sources WHERE enabled = 1 ORDER BY created_at ASC",
  ).all<{ slug: string; name: string; provider: string }>();

  const enabled_providers =
    results.length > 0
      ? results
      : (["github", "google", "microsoft", "discord"] as const)
          .filter(
            (p) =>
              !!(config as unknown as Record<string, string>)[`${p}_client_id`],
          )
          .map((p) => ({
            slug: p,
            name: p.charAt(0).toUpperCase() + p.slice(1),
            provider: p,
          }));

  return c.json({
    site_name: config.site_name,
    site_description: config.site_description,
    site_icon_url: proxyImageUrl(c.env.APP_URL, config.site_icon_url),
    unproxied_site_icon_url: config.site_icon_url,
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
    enabled_providers,
  });
});

export default app;
