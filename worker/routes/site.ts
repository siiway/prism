// Public site config and health endpoints

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { proxyImageUrl } from "../lib/proxyImage";
import type { Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/site", async (c) => {
  const config = await getConfig(c.env.DB);
  const { results: enabled_providers } = await c.env.DB.prepare(
    "SELECT slug, name, provider FROM oauth_sources WHERE enabled = 1 ORDER BY created_at ASC",
  ).all<{ slug: string; name: string; provider: string }>();

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
    tg_notify_source_slug: config.tg_notify_source_slug,
    enable_public_profiles: config.enable_public_profiles,
    default_profile_show_display_name: config.default_profile_show_display_name,
    default_profile_show_avatar: config.default_profile_show_avatar,
    default_profile_show_email: config.default_profile_show_email,
    default_profile_show_joined_at: config.default_profile_show_joined_at,
    default_profile_show_gpg_keys: config.default_profile_show_gpg_keys,
    default_profile_show_authorized_apps:
      config.default_profile_show_authorized_apps,
    default_profile_show_owned_apps: config.default_profile_show_owned_apps,
    default_profile_show_domains: config.default_profile_show_domains,
    default_profile_show_joined_teams: config.default_profile_show_joined_teams,
    default_profile_show_readme: config.default_profile_show_readme,
    profile_readme_max_bytes: config.profile_readme_max_bytes,
    // Token value itself is never exposed; the boolean lets the UI tell the
    // user whether the site has a fallback token (so a personal PAT is
    // optional) or not (so without one, fetches use the 60/hr unauth limit).
    github_readme_has_site_token: !!config.github_readme_token,
    github_readme_cache_ttl_seconds: config.github_readme_cache_ttl_seconds,
    default_team_profile_show_description:
      config.default_team_profile_show_description,
    default_team_profile_show_avatar: config.default_team_profile_show_avatar,
    default_team_profile_show_owner: config.default_team_profile_show_owner,
    default_team_profile_show_member_count:
      config.default_team_profile_show_member_count,
    default_team_profile_show_apps: config.default_team_profile_show_apps,
    default_team_profile_show_domains: config.default_team_profile_show_domains,
    default_team_profile_show_members: config.default_team_profile_show_members,
    enabled_providers,
  });
});

export default app;
