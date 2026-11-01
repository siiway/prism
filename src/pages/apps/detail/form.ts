// Form state for the app detail page.
//
// The page edits one app, but each card saves on its own: a card's Save sends
// only its section's fields, and Discard drops only its edits. Edits sit on
// top of the server copy, so a save that refetches the app leaves nothing
// stale behind.

import type { CreateAppBody, OAuthApp, RedirectUri } from "../../../lib/api";

export interface AppForm {
  name: string;
  description: string;
  icon_url: string;
  website_url: string;
  redirect_uris: RedirectUri[];
  /** Raw textarea text, one URI per line; parsed on save so typing a new
   *  line doesn't get swallowed. */
  post_logout_text: string;
  backchannel_logout_uri: string;
  token_endpoint_auth_method: string;
  jwks: string;
  jwks_uri: string;
  allowed_scopes: string[];
  optional_scopes: string[];
  is_public: boolean;
  use_jwt_tokens: boolean;
}

export type Section = "details" | "redirects" | "logout" | "scopes" | "client";

export function formFromApp(app: OAuthApp): AppForm {
  return {
    name: app.name,
    description: app.description,
    icon_url: app.unproxied_icon_url ?? "",
    website_url: app.website_url ?? "",
    redirect_uris: app.redirect_uris,
    post_logout_text: (app.post_logout_redirect_uris ?? []).join("\n"),
    backchannel_logout_uri: app.backchannel_logout_uri ?? "",
    token_endpoint_auth_method: app.token_endpoint_auth_method ?? "",
    jwks: app.jwks ?? "",
    jwks_uri: app.jwks_uri ?? "",
    allowed_scopes: app.allowed_scopes,
    optional_scopes: app.optional_scopes ?? [],
    is_public: app.is_public,
    use_jwt_tokens: app.use_jwt_tokens,
  };
}

const SECTION_FIELDS: Record<Section, (keyof AppForm)[]> = {
  details: ["name", "description", "icon_url", "website_url"],
  redirects: ["redirect_uris"],
  logout: ["post_logout_text", "backchannel_logout_uri"],
  scopes: ["allowed_scopes", "optional_scopes"],
  client: [
    "is_public",
    "token_endpoint_auth_method",
    "jwks",
    "jwks_uri",
    "use_jwt_tokens",
  ],
};

export function sectionFields(section: Section) {
  return SECTION_FIELDS[section];
}

/** The PATCH body for one section. Empty strings clear optional values. */
export function payloadFor(
  section: Section,
  f: AppForm,
): Partial<CreateAppBody> {
  switch (section) {
    case "details":
      return {
        name: f.name.trim(),
        description: f.description.trim(),
        icon_url: f.icon_url.trim(),
        website_url: f.website_url.trim(),
      };
    case "redirects":
      return { redirect_uris: f.redirect_uris };
    case "logout":
      return {
        post_logout_redirect_uris: f.post_logout_text
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        backchannel_logout_uri: f.backchannel_logout_uri.trim() || null,
      };
    case "scopes":
      return {
        allowed_scopes: f.allowed_scopes,
        optional_scopes: f.optional_scopes.filter((s) =>
          f.allowed_scopes.includes(s),
        ),
      };
    case "client":
      return {
        is_public: f.is_public,
        token_endpoint_auth_method: f.token_endpoint_auth_method || null,
        jwks: f.jwks.trim() || null,
        jwks_uri: f.jwks_uri.trim() || null,
        use_jwt_tokens: f.use_jwt_tokens,
      };
  }
}

export interface AppFormApi {
  form: AppForm;
  set: <K extends keyof AppForm>(key: K, value: AppForm[K]) => void;
  dirty: (section: Section) => boolean;
  /** The write in flight: a section's Save, or "switch" for an instant
   *  toggle elsewhere on the page. Only one runs at a time, because every
   *  app update rewrites the whole row from what the server read. */
  saving: Section | "switch" | null;
  save: (section: Section) => void;
  discard: (section: Section) => void;
  /** Run an instant update (a switch) under the same one-at-a-time rule.
   *  Does nothing while another write is in flight. */
  exclusive: (run: () => Promise<void>) => Promise<void>;
}
