// Shared by the new-source and source pages: the form shape, provider list,
// and how a form becomes the API payload. The source page saves the form in
// sections (one per card), so each section knows its own fields.

import type { TFunction } from "i18next";
import type { OAuthSource } from "../../../lib/api";
import { PROVIDER_ICON_URLS } from "../../../lib/providerIcons";

// Brand names stay as they are in every language; only the generic
// providers have names that get translated.
const BRANDS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
  discord: "Discord",
  telegram: "Telegram",
  x: "X (Twitter)",
  cloudflare: "Cloudflare",
};

export const PROVIDERS = [...Object.keys(BRANDS), "oidc", "oauth2"];

export function providerLabel(t: TFunction, provider: string): string {
  if (provider === "oidc") return t("admin.oauthProviderOidc");
  if (provider === "oauth2") return t("admin.oauthProviderOauth2");
  return BRANDS[provider] ?? provider;
}

/** Providers whose endpoints are configured by hand (or discovered). */
export const isGeneric = (provider: string) =>
  provider === "oidc" || provider === "oauth2";

export const hasBuiltinIcon = (provider: string) =>
  provider in PROVIDER_ICON_URLS;

/** Black silhouettes that the sign-in page inverts in dark mode. */
export const invertsOnDark = (provider: string) =>
  provider === "github" || provider === "x";

/** Same rule as the server: it becomes part of the callback URL. */
export const slugValid = (slug: string) => /^[a-z0-9-]{1,64}$/.test(slug);

/** What the provider's app needs to know about Prism: the callback URL for
 *  OAuth providers, the site's domain for a Telegram bot. */
export function setupTarget(
  origin: string,
  provider: string,
  slug: string,
): { kind: "callback" | "domain"; value: string } {
  if (provider === "telegram") {
    let host = origin;
    try {
      host = new URL(origin).host;
    } catch {
      // Keep the origin as given.
    }
    return { kind: "domain", value: host };
  }
  return {
    kind: "callback",
    value: `${origin}/api/connections/${slugValid(slug) ? slug : "…"}/callback`,
  };
}

/** How to set the source up at the provider, in one sentence. */
export function setupHint(t: TFunction, provider: string): string {
  if (provider === "telegram") return t("admin.oauthSetupTelegram");
  return t("admin.oauthSetup", {
    provider: hasBuiltinIcon(provider)
      ? providerLabel(t, provider)
      : t("admin.oauthTheProvider"),
  });
}

/** Telegram calls its credentials a bot ID and token. */
export function credentialLabels(t: TFunction, provider: string) {
  return provider === "telegram"
    ? { id: t("admin.oauthBotId"), secret: t("admin.oauthBotToken") }
    : { id: t("admin.oauthClientId"), secret: t("admin.oauthClientSecret") };
}

/** Keeps browsers and password managers from filling a saved login into
 *  the credential fields (the client ID reads to them like a username).
 *  Spread onto the input; secrets also take autoComplete "new-password". */
export const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
} as const;

export type IconChoice = "builtin" | "custom" | "none";

export interface SourceForm {
  slug: string;
  provider: string;
  name: string;
  client_id: string;
  client_secret: string;
  issuer_url: string;
  auth_url: string;
  token_url: string;
  userinfo_url: string;
  scopes: string;
  icon: IconChoice;
  icon_url: string;
  icon_only: 0 | 1 | 2;
  trusted: boolean;
}

export const EMPTY_SOURCE: SourceForm = {
  slug: "",
  provider: "github",
  name: "",
  client_id: "",
  client_secret: "",
  issuer_url: "",
  auth_url: "",
  token_url: "",
  userinfo_url: "",
  scopes: "",
  icon: "builtin",
  icon_url: "",
  icon_only: 0,
  trusted: true,
};

/** Generic providers have no built-in icon, so they start with none. */
export function withProvider(form: SourceForm, provider: string): SourceForm {
  const icon =
    form.icon === "builtin" && !hasBuiltinIcon(provider)
      ? "none"
      : form.icon === "none" && hasBuiltinIcon(provider) && !form.icon_url
        ? "builtin"
        : form.icon;
  return { ...form, provider, icon };
}

/** An existing source as an edit form. Credentials start blank: the server
 *  never returns them, and blank means "keep the current value". */
export function formFromSource(src: OAuthSource): SourceForm {
  const iconUrl = src.icon_url ?? "";
  const icon: IconChoice =
    src.show_icon === 0
      ? "none"
      : iconUrl
        ? "custom"
        : hasBuiltinIcon(src.provider)
          ? "builtin"
          : "none";
  return {
    slug: src.slug,
    provider: src.provider,
    name: src.name,
    client_id: "",
    client_secret: "",
    issuer_url: src.issuer_url ?? "",
    auth_url: src.auth_url ?? "",
    token_url: src.token_url ?? "",
    userinfo_url: src.userinfo_url ?? "",
    scopes: src.scopes ?? "",
    icon,
    icon_url: iconUrl,
    icon_only: (src.icon_only === 1 || src.icon_only === 2
      ? src.icon_only
      : 0) as 0 | 1 | 2,
    trusted: src.trusted !== 0,
  };
}

/** The icon URL the sign-in button would show, before proxying. */
export function resolvedIcon(form: SourceForm): string | null {
  if (form.icon === "none") return null;
  if (form.icon === "custom") return form.icon_url.trim() || null;
  return PROVIDER_ICON_URLS[form.provider] ?? null;
}

export const isHttpsUrl = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

// ─── Sections ────────────────────────────────────────────────────────────────

export type Section = "button" | "credentials" | "endpoints";

const SECTION_KEYS: Record<Section, (keyof SourceForm)[]> = {
  button: ["name", "icon", "icon_url", "icon_only"],
  credentials: ["client_id", "client_secret"],
  endpoints: ["issuer_url", "auth_url", "token_url", "userinfo_url", "scopes"],
};

/** Values as they'd be saved: trimmed, and the icon URL only when it's used. */
function normalized(form: SourceForm): SourceForm {
  return {
    ...form,
    name: form.name.trim(),
    client_id: form.client_id.trim(),
    issuer_url: form.issuer_url.trim(),
    auth_url: form.auth_url.trim(),
    token_url: form.token_url.trim(),
    userinfo_url: form.userinfo_url.trim(),
    scopes: form.scopes.trim(),
    icon_url: form.icon === "custom" ? form.icon_url.trim() : "",
  };
}

export function sectionDirty(
  section: Section,
  form: SourceForm,
  saved: SourceForm,
): boolean {
  const a = normalized(form);
  const b = normalized(saved);
  return SECTION_KEYS[section].some((k) => a[k] !== b[k]);
}

/** Whether the section can be saved as it stands. */
export function sectionValid(section: Section, form: SourceForm): boolean {
  const f = normalized(form);
  switch (section) {
    case "button":
      return !!f.name && (f.icon !== "custom" || isHttpsUrl(f.icon_url));
    case "credentials":
      return !!f.client_id || !!form.client_secret;
    case "endpoints":
      return (
        !isGeneric(f.provider) ||
        (!!f.auth_url && !!f.token_url && !!f.userinfo_url)
      );
  }
}

/** Copy one section's fields from `from` into `form`. */
export function withSection(
  form: SourceForm,
  section: Section,
  from: SourceForm,
): SourceForm {
  const next = { ...form };
  for (const k of SECTION_KEYS[section])
    (next as Record<string, unknown>)[k] = from[k];
  return next;
}

/** The PATCH body for one section. Blank credentials are left out so the
 *  stored ones are kept; an empty endpoint or icon URL clears it. */
export function sectionPayload(section: Section, form: SourceForm) {
  const f = normalized(form);
  switch (section) {
    case "button":
      return {
        name: f.name,
        show_icon: f.icon !== "none",
        icon_url: f.icon_url,
        icon_only: f.icon_only,
      };
    case "credentials":
      return {
        client_id: f.client_id || undefined,
        client_secret: form.client_secret || undefined,
      };
    case "endpoints":
      return {
        issuer_url: f.issuer_url,
        auth_url: f.auth_url,
        token_url: f.token_url,
        userinfo_url: f.userinfo_url,
        scopes: f.scopes,
      };
  }
}

export function createComplete(form: SourceForm): boolean {
  const f = normalized(form);
  return (
    slugValid(f.slug.trim()) &&
    !!f.client_id &&
    !!form.client_secret &&
    sectionValid("button", form) &&
    sectionValid("endpoints", form)
  );
}

export function createPayload(form: SourceForm) {
  const f = normalized(form);
  return {
    slug: f.slug.trim(),
    provider: f.provider,
    name: f.name,
    client_id: f.client_id,
    client_secret: form.client_secret,
    icon_url: f.icon_url || undefined,
    show_icon: f.icon !== "none",
    icon_only: f.icon_only,
    trusted: f.trusted,
    ...(isGeneric(f.provider) && {
      auth_url: f.auth_url,
      token_url: f.token_url,
      userinfo_url: f.userinfo_url,
      scopes: f.scopes || undefined,
      issuer_url: f.issuer_url || undefined,
    }),
  };
}
