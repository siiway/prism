// Public site config and health endpoints

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { turnstileEndpointFor } from "../lib/turnstile";
import { proxyImageUrl } from "../lib/proxyImage";
import {
  resolveProviderIconUrl,
  isMonochromeDarkProvider,
} from "../lib/providerIcons";
import type { Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/site", async (c) => {
  const config = await getConfig(c.env.DB);
  const { results: providerRows } = await c.env.DB.prepare(
    "SELECT slug, name, provider, icon_url, show_icon, icon_only FROM oauth_sources WHERE enabled = 1 ORDER BY created_at ASC",
  ).all<{
    slug: string;
    name: string;
    provider: string;
    icon_url: string | null;
    show_icon: number;
    icon_only: number;
  }>();

  // Pre-register each resolved icon through the image proxy so the
  // (unauthenticated) Login page can render it without hitting the
  // auth-required /proxy/image/register endpoint.
  const enabled_providers = await Promise.all(
    providerRows.map(async (p) => {
      const resolved = resolveProviderIconUrl(p);
      const icon_proxied_url = await proxyImageUrl(
        c.env.APP_URL,
        c.env.DB,
        resolved,
      );
      // Only auto-invert when we're serving the built-in default for a
      // known-monochrome provider. If the admin pasted their own icon_url
      // override we have no idea what's in it — leave it alone.
      const icon_invert_on_dark =
        !p.icon_url &&
        resolved !== null &&
        isMonochromeDarkProvider(p.provider);
      // icon_only is gated on actually having an icon — otherwise the
      // button would render empty. Flatten that here so the frontend
      // doesn't have to repeat the guard. Values: 0 = text + icon,
      // 1 = icon-only small, 2 = icon-only large.
      const icon_only =
        icon_proxied_url !== null && (p.icon_only === 1 || p.icon_only === 2)
          ? p.icon_only
          : 0;
      return {
        slug: p.slug,
        name: p.name,
        provider: p.provider,
        icon_url: p.icon_url,
        show_icon: p.show_icon,
        icon_proxied_url,
        icon_invert_on_dark,
        icon_only,
      };
    }),
  );

  const turnstile = await turnstileEndpointFor(c, config);

  return c.json({
    site_name: config.site_name,
    site_description: config.site_description,
    site_icon_url: await proxyImageUrl(
      c.env.APP_URL,
      c.env.DB,
      config.site_icon_url,
    ),
    unproxied_site_icon_url: config.site_icon_url,
    allow_registration: config.allow_registration,
    invite_only: config.invite_only,
    captcha_provider: config.captcha_provider,
    captcha_site_key: config.captcha_site_key,
    turnstile_endpoint: turnstile.directive,
    turnstile_china_site_key: turnstile.chinaSiteKey,
    pow_difficulty: config.pow_difficulty,
    require_email_verification: config.require_email_verification,
    email_verify_methods: config.email_verify_methods,
    accent_color: config.accent_color,
    custom_css: config.custom_css,
    initialized: config.initialized,
    r2_enabled: !!c.env.R2_ASSETS,
    tg_notify_source_slug: config.tg_notify_source_slug,
    discord_notify_source_slug: config.discord_bot_token
      ? config.discord_notify_source_slug
      : "",
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
    default_team_require_2fa: config.default_team_require_2fa,
    default_team_require_verified_email:
      config.default_team_require_verified_email,
    // Sub-team configurability — clients use these to hide UI when the
    // feature is off, to enforce the depth cap before round-tripping, etc.
    enable_sub_teams: config.enable_sub_teams,
    max_team_depth: config.max_team_depth,
    inherit_team_membership: config.inherit_team_membership,
    inherit_team_domains: config.inherit_team_domains,
    default_team_profile_show_sub_teams:
      config.default_team_profile_show_sub_teams,
    enabled_providers,
  });
});

export default app;
