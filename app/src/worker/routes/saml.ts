// SAML 2.0 identity provider.
//
// Protocol endpoints (mounted at /saml):
//   GET  /saml/metadata   IdP metadata (also the IdP entity ID)
//   GET  /saml/sso        AuthnRequest, HTTP-Redirect binding
//   POST /saml/sso        AuthnRequest, HTTP-POST binding
//   GET  /saml/slo        LogoutRequest / LogoutResponse, HTTP-Redirect
//   POST /saml/slo        LogoutRequest / LogoutResponse, HTTP-POST
//
// A valid request is parked in KV and the browser goes to the SPA page
// /saml/authorize, which asks the API below what happens next (sign in,
// consent, ...) and finally POSTs the signed Response to the ACS URL. The
// page does the sign-in check itself rather than through a route loader,
// so an IsPassive request can be answered without ever showing a login.
//
// API (mounted at /api/saml):
//   GET  /api/saml/requests/:token   what the page should do next
//   POST /api/saml/requests/:token   approve / deny / decline; returns the
//                                    Response to post
//   POST /api/saml/logout            move a browser sign-out on (see
//                                    lib/saml/logout.ts), once the user
//                                    confirms one another site asked
//                                    for; returns the next
//                                    message for the browser to carry
//
// Requests are only answered at an ACS URL registered for the SP that sent
// them; a request whose SP or ACS URL can't be trusted never produces a
// Response and shows an error page instead.

import { Hono, type Context } from "hono";
import { optionalAuth } from "../middleware/auth";
import {
  clearSamlLogoutCookie,
  readSamlLogoutCookie,
  setSamlLogoutCookie,
} from "../lib/cookies";
import { checkAccessWhitelist } from "../lib/appAccess";
import {
  declaredLengthExceedsLimit,
  readStreamWithLimit,
} from "../lib/bodyLimit";
import { randomBase64url, randomId, sha256Hex } from "../lib/crypto";
import { computeIsVerified } from "../lib/domainVerify";
import {
  buildConsentAppSummary,
  recordAppAuthorization,
} from "../lib/oauthClients";
import { endBrowserSession } from "../lib/session";
import {
  checkAppAuthorizationAllowed,
  type RestrictionState,
} from "../lib/userCapabilities";
import {
  BINDING_POST,
  SamlError,
  buildErrorResponse,
  buildIdpMetadata,
  buildSuccessResponse,
  decodePostBinding,
  decodeRedirectBinding,
  logoutRequestIsFresh,
  nameIdPolicyAllows,
  parseAuthnRequest,
  parseLogoutRequest,
  parseLogoutResponse,
  type Destination,
  type SamlStatus,
} from "../lib/saml/protocol";
import {
  getServiceProvider,
  idpEndpoints,
  parseAcsUrls,
  releasedScopes,
  samlAttributes,
  samlBlock,
  type SamlSpRow,
} from "../lib/saml/serviceProviders";
import {
  beginLogout,
  loadLogout,
  loadLogoutAwaiting,
  nextLogoutMessage,
  recordLogoutResponse,
  recordSamlSession,
  samlSessionIndex,
  startSpLogout,
} from "../lib/saml/logout";
import {
  bindProfile,
  boundProfile,
  profileChoices,
  profileSummary,
  type SamlProfileRow,
} from "../lib/saml/profiles";
import { getSamlSigner } from "../lib/saml/sign";
import {
  verifyPostSignature,
  verifyRedirectSignature,
} from "../lib/saml/verify";
import { base64ToBytes } from "../lib/saml/x509";
import type { Element } from "@xmldom/xmldom";
import type { AuthUser, OAuthAppRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

/** How long a parked request waits for the user (sign-in included). */
const REQUEST_TTL_SECONDS = 600;
/** A form-encoded POST binding body: the 32 KiB SAMLRequest limit, its
 *  encoding overhead and RelayState fit well within this. */
const MAX_POST_BODY = 128 * 1024;
/** RelayState is opaque to Prism and echoed back; the spec suggests 80
 *  bytes, real SPs send more, so only absurd values are refused. */
const MAX_RELAY_STATE = 2048;

/** A saml_requests row (see migration 0085). */
interface PendingRequest {
  token_hash: string;
  app_id: string;
  /** AuthnRequest ID, echoed as InResponseTo. */
  request_id: string;
  acs_url: string;
  relay_state: string | null;
  name_id_format: string | null;
  force_authn: number;
  is_passive: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

// ─── Protocol endpoints ──────────────────────────────────────────────────────

export const samlProtocolRoutes = new Hono<AppEnv>();

samlProtocolRoutes.get("/metadata", async (c) => {
  const { entityId, ssoUrl, sloUrl } = idpEndpoints(c.env.APP_URL);
  const signer = await getSamlSigner(c.env);
  return c.body(
    buildIdpMetadata({
      entityId,
      ssoUrl,
      sloUrl,
      certificate: signer.certificate,
    }),
    200,
    {
      "Content-Type": "application/samlmetadata+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  );
});

/** Send the browser to the SPA page with an error it can show. */
function errorPage(c: Context<AppEnv>, code: string) {
  return c.redirect(`/saml/authorize?error=${encodeURIComponent(code)}`, 303);
}

async function receiveRequest(
  c: Context<AppEnv>,
  decode: () => Promise<string>,
  relayState: string | null,
) {
  try {
    const request = parseAuthnRequest(await decode());
    if (relayState && relayState.length > MAX_RELAY_STATE)
      throw new SamlError("saml_request_invalid");
    // SAML Core §3.2.1: a request addressed elsewhere must be discarded.
    if (
      request.destination &&
      request.destination !== idpEndpoints(c.env.APP_URL).ssoUrl
    )
      throw new SamlError("saml_request_invalid");

    const sp = await c.env.DB.prepare(
      `SELECT sp.*, a.owner_id, a.saml_override FROM saml_service_providers sp
       JOIN oauth_apps a ON a.id = sp.app_id
       WHERE sp.entity_id = ? AND a.is_active = 1`,
    )
      .bind(request.issuer)
      .first<SamlSpRow & { owner_id: string; saml_override: number | null }>();
    if (!sp) throw new SamlError("saml_unknown_sp");
    const blocked = await samlBlock(c.env.DB, sp);
    if (blocked) throw new SamlError(blocked);

    const acsUrls = parseAcsUrls(sp);
    const acsUrl = request.acsUrl ?? acsUrls[0];
    if (!acsUrl || !acsUrls.includes(acsUrl))
      throw new SamlError("saml_acs_mismatch");
    // Responses go back with the HTTP-POST binding only.
    if (request.protocolBinding && request.protocolBinding !== BINDING_POST)
      throw new SamlError("saml_binding_unsupported");

    const token = randomBase64url(32);
    const now = Math.floor(Date.now() / 1000);
    const db = c.env.DB;
    const [, stored] = await db.batch([
      // An expired row for the same ID no longer counts as a replay.
      db
        .prepare(
          "DELETE FROM saml_requests WHERE app_id = ? AND request_id = ? AND expires_at <= ?",
        )
        .bind(sp.app_id, request.id, now),
      db
        .prepare(
          `INSERT INTO saml_requests (token_hash, app_id, request_id, acs_url, relay_state,
             name_id_format, force_authn, is_passive, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(app_id, request_id) DO NOTHING`,
        )
        .bind(
          await sha256Hex(token),
          sp.app_id,
          request.id,
          acsUrl,
          relayState || null,
          request.nameIdFormat,
          request.forceAuthn ? 1 : 0,
          request.isPassive ? 1 : 0,
          now,
          now + REQUEST_TTL_SECONDS,
        ),
    ]);
    // The same AuthnRequest again (a retry or a replay): one sign-in each.
    if (!stored.meta.changes) throw new SamlError("saml_request_used");
    return c.redirect(
      `/saml/authorize?request=${encodeURIComponent(token)}`,
      303,
    );
  } catch (err) {
    if (err instanceof SamlError) return errorPage(c, err.code);
    throw err;
  }
}

samlProtocolRoutes.get("/sso", async (c) => {
  const value = c.req.query("SAMLRequest");
  if (!value) return errorPage(c, "saml_request_invalid");
  return receiveRequest(
    c,
    () => decodeRedirectBinding(value),
    c.req.query("RelayState") ?? null,
  );
});

/** The request body as text, or null once it passes `max` bytes. The
 *  endpoint is unauthenticated, so nothing larger is buffered. */
async function readBoundedText(
  req: Request,
  max: number,
): Promise<string | null> {
  if (declaredLengthExceedsLimit(req.headers.get("Content-Length"), max))
    return null;
  const { bytes } = await readStreamWithLimit(req.body, max);
  return bytes && new TextDecoder().decode(bytes);
}

samlProtocolRoutes.post("/sso", async (c) => {
  const text = await readBoundedText(c.req.raw, MAX_POST_BODY);
  if (text === null) return errorPage(c, "saml_request_invalid");
  const body = new URLSearchParams(text);
  const value = body.get("SAMLRequest");
  if (!value) return errorPage(c, "saml_request_invalid");
  const relayState = body.get("RelayState");
  return receiveRequest(c, async () => decodePostBinding(value), relayState);
});

// ─── Single logout ───────────────────────────────────────────────────────────

/** Send the browser to the logout page with an error it can show. */
function logoutErrorPage(c: Context<AppEnv>, code: string) {
  return c.redirect(`/logout?error=${encodeURIComponent(code)}`, 303);
}

/**
 * A logout message from an SP: a LogoutRequest starts a single logout, and
 * a LogoutResponse answers the LogoutRequest Prism sent it during one.
 * Either way the browser goes on to the /logout page.
 */
async function receiveLogout(
  c: Context<AppEnv>,
  message: {
    field: "SAMLRequest" | "SAMLResponse";
    xml: () => Promise<string>;
    /** Whether the message (whose root is given) is signed by the SP's
     *  certificate (DER), the way its binding signs. */
    signedBy: (root: Element, certificate: Uint8Array) => Promise<boolean>;
  },
  relayState: string | null,
) {
  try {
    if (relayState && relayState.length > MAX_RELAY_STATE)
      throw new SamlError("saml_request_invalid");
    const { sloUrl } = idpEndpoints(c.env.APP_URL);
    const xml = await message.xml();

    if (message.field === "SAMLRequest") {
      const request = parseLogoutRequest(xml);
      if (request.destination && request.destination !== sloUrl)
        throw new SamlError("saml_request_invalid");
      const sp = await c.env.DB.prepare(
        `SELECT sp.app_id, sp.slo_url, sp.signing_cert, a.owner_id, a.saml_override
         FROM saml_service_providers sp
         JOIN oauth_apps a ON a.id = sp.app_id
         WHERE sp.entity_id = ? AND a.is_active = 1`,
      )
        .bind(request.issuer)
        .first<{
          app_id: string;
          slo_url: string | null;
          signing_cert: string | null;
          owner_id: string;
          saml_override: number | null;
        }>();
      if (!sp) throw new SamlError("saml_unknown_sp");
      // An app whose SAML an admin stopped can't sign anyone out either.
      const blocked = await samlBlock(c.env.DB, sp);
      if (blocked) throw new SamlError(blocked);
      // Nowhere registered to send the answer.
      if (!sp.slo_url) throw new SamlError("saml_slo_not_configured");
      // With the SP's certificate on file, only a signed request counts:
      // addressed here (SAML Bindings §3.4.5.2 / §3.5.5.2), issued just
      // now, and signed with that certificate.
      if (
        sp.signing_cert &&
        (request.destination !== sloUrl ||
          !logoutRequestIsFresh(request) ||
          !(await message.signedBy(
            request.root,
            base64ToBytes(sp.signing_cert),
          )))
      )
        throw new SamlError("saml_signature_invalid");
      const page = await startSpLogout(c.env.DB, {
        appId: sp.app_id,
        requestId: request.id,
        relayState,
        nameId: request.nameId,
        verified: !!sp.signing_cert,
      });
      return c.redirect(page, 303);
    }

    const response = parseLogoutResponse(xml);
    if (response.destination && response.destination !== sloUrl)
      throw new SamlError("saml_request_invalid");
    // The answer to Prism's LogoutRequest names it by ID. Back on /logout,
    // the browser's cookie says which logout to move on.
    const row = await loadLogoutAwaiting(c.env.DB, response.inResponseTo);
    if (
      !row ||
      !(await recordLogoutResponse(c.env.DB, row, response, (certificate) =>
        message.signedBy(response.root, certificate),
      ))
    )
      throw new SamlError("saml_logout_expired");
    return c.redirect("/logout", 303);
  } catch (err) {
    if (err instanceof SamlError) return logoutErrorPage(c, err.code);
    throw err;
  }
}

samlProtocolRoutes.get("/slo", async (c) => {
  const request = c.req.query("SAMLRequest");
  const response = c.req.query("SAMLResponse");
  const value = request ?? response;
  if (!value) return logoutErrorPage(c, "saml_request_invalid");
  const field = request ? "SAMLRequest" : "SAMLResponse";
  // The signature covers the query as sent, before any decoding.
  const url = c.req.url;
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return receiveLogout(
    c,
    {
      field,
      xml: () => decodeRedirectBinding(value),
      signedBy: (_root, certificate) =>
        verifyRedirectSignature(query, field, certificate),
    },
    c.req.query("RelayState") ?? null,
  );
});

samlProtocolRoutes.post("/slo", async (c) => {
  const text = await readBoundedText(c.req.raw, MAX_POST_BODY);
  if (text === null) return logoutErrorPage(c, "saml_request_invalid");
  const body = new URLSearchParams(text);
  const request = body.get("SAMLRequest");
  const value = request ?? body.get("SAMLResponse");
  if (!value) return logoutErrorPage(c, "saml_request_invalid");
  return receiveLogout(
    c,
    {
      field: request ? "SAMLRequest" : "SAMLResponse",
      xml: async () => decodePostBinding(value),
      signedBy: verifyPostSignature,
    },
    body.get("RelayState"),
  );
});

// ─── API for the /saml/authorize page ────────────────────────────────────────

export const samlApiRoutes = new Hono<AppEnv>();
samlApiRoutes.use("*", optionalAuth);

interface Loaded {
  pending: PendingRequest;
  app: OAuthAppRow;
  sp: SamlSpRow;
}

async function loadRequest(
  c: Context<AppEnv>,
): Promise<Loaded | { error: string }> {
  const token = c.req.param("token") ?? "";
  const pending = token
    ? await c.env.DB.prepare(
        "SELECT * FROM saml_requests WHERE token_hash = ? AND expires_at > ? AND consumed_at IS NULL",
      )
        .bind(await sha256Hex(token), Math.floor(Date.now() / 1000))
        .first<PendingRequest>()
    : null;
  if (!pending) return { error: "saml_request_expired" };
  const [app, sp] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ? AND is_active = 1")
      .bind(pending.app_id)
      .first<OAuthAppRow>(),
    getServiceProvider(c.env.DB, pending.app_id),
  ]);
  // The app was disabled, or SAML turned off for it, since the request
  // arrived; or the ACS URL was removed from its list.
  if (!app || !sp || !parseAcsUrls(sp).includes(pending.acs_url))
    return { error: "saml_unknown_sp" };
  // Or an admin turned SAML off for the app, its owner or the site.
  const blocked = await samlBlock(c.env.DB, app);
  if (blocked) return { error: blocked };
  return { pending, app, sp };
}

// "profile": consent is settled (a first-party app, or one the user always
// authorizes), and the first sign-in only asks which profile the app gets.
type Next = "login" | "reauth" | "consent" | "profile" | "continue" | "decline";

interface Evaluation {
  next: Next;
  /** For "decline": the status the SP receives. */
  status?: Exclude<SamlStatus, "Success">;
  /** A reason the user can't sign in to this app, shown on the page. */
  error?: string;
  scopes: string[];
  session?: { created_at: number; amr: string[] };
  /** The signed-in user as stored now. The session token's copy of email,
   *  username and name is a snapshot from sign-in, and an assertion must
   *  never carry an address the user has since given up. */
  account?: AuthUser;
  /** Scopes the user's stored consent for this app already holds. */
  consentedScopes?: string[];
  /** The SAML profile the app gets for the user, once chosen. */
  profile?: SamlProfileRow | null;
  /** Before one is chosen: the user's shared profiles to pick from. */
  profileChoices?: SamlProfileRow[];
}

/** The signed-in user as stored now, and what restricts the account; null
 *  once it's gone or disabled. */
async function currentAccount(
  db: D1Database,
  user: AuthUser,
): Promise<{ account: AuthUser; restriction: RestrictionState } | null> {
  const row = await db
    .prepare(
      `SELECT email, username, display_name, avatar_url, email_verified,
         origin_team_id, origin_join_completed, converted_at
       FROM users WHERE id = ? AND is_active = 1`,
    )
    .bind(user.id)
    .first<
      {
        email: string;
        username: string;
        display_name: string;
        avatar_url: string | null;
        email_verified: number;
      } & RestrictionState
    >();
  if (!row) return null;
  const { origin_team_id, origin_join_completed, converted_at, ...fields } =
    row;
  return {
    account: {
      ...user,
      ...fields,
      email_verified: fields.email_verified === 1,
    },
    restriction: { origin_team_id, origin_join_completed, converted_at },
  };
}

/**
 * What happens with this request for the current user. Used by both the
 * page's GET (to decide what to show) and the POST (to re-check before
 * issuing anything), so the page can't skip a step.
 */
async function evaluate(
  c: Context<AppEnv>,
  { pending, app, sp }: Loaded,
): Promise<Evaluation> {
  const scopes = releasedScopes(app);
  const passive = pending.is_passive === 1;
  const decline = (status: Evaluation["status"]): Evaluation => ({
    next: "decline",
    status,
    scopes,
  });

  if (!nameIdPolicyAllows(pending.name_id_format, sp.name_id_format))
    return decline("InvalidNameIDPolicy");

  const sessionUser = c.get("user");
  const [current, row] = sessionUser
    ? await Promise.all([
        currentAccount(c.env.DB, sessionUser),
        c.env.DB.prepare("SELECT created_at, amr FROM sessions WHERE id = ?")
          .bind(c.get("sessionId"))
          .first<{ created_at: number; amr: string | null }>(),
      ])
    : [null, null];
  if (!current)
    return passive ? decline("NoPassive") : { next: "login", scopes };

  const { account: user, restriction } = current;
  const session = {
    created_at: row?.created_at ?? 0,
    amr: row?.amr ? (JSON.parse(row.amr) as string[]) : [],
  };
  // ForceAuthn: the user must sign in again after the request arrived. A
  // session from the same second can't be told apart, so it isn't enough.
  if (pending.force_authn === 1 && session.created_at <= pending.created_at)
    return passive ? decline("NoPassive") : { next: "reauth", scopes };

  // Whether the account may use the app; the SAML profile the app gets,
  // chosen at the first sign-in to it; and the user's stored consent
  // (first-party apps need none).
  const [restricted, notListed, profile, choices, consent] = await Promise.all([
    checkAppAuthorizationAllowed(c.env.DB, restriction, app),
    checkAccessWhitelist(c.env.DB, app, user.id),
    boundProfile(c.env.DB, app.id, user.id),
    profileChoices(c.env.DB, app.id, user.id),
    app.is_first_party
      ? null
      : c.env.DB.prepare(
          "SELECT scopes, auto_authorize FROM oauth_consents WHERE user_id = ? AND client_id = ?",
        )
          .bind(user.id, app.client_id)
          .first<{ scopes: string; auto_authorize: number }>(),
  ]);
  // Accounts that may not use the app see why on the page (and can send the
  // SP a refusal); a passive request just gets the refusal.
  const refusal = restricted || notListed;
  const emailUnverified =
    sp.name_id_format === "email" && !(user.email && user.email_verified);
  if (refusal || emailUnverified)
    return passive
      ? decline("RequestDenied")
      : {
          next: "consent",
          error: refusal ?? "saml_email_unverified",
          scopes,
          session,
          account: user,
        };

  const base = {
    scopes,
    session,
    account: user,
    profile,
    // Raced with a sign-in that just chose: nothing left to pick.
    profileChoices: profile ? [] : choices,
  };

  if (!app.is_first_party) {
    // The row is shared with OAuth, whose scopes add openid and the like:
    // a remembered consent counts when it covers what SAML releases.
    const consentedScopes = consent
      ? (JSON.parse(consent.scopes) as string[])
      : [];
    const remembered =
      consent?.auto_authorize === 1 &&
      scopes.every((s) => consentedScopes.includes(s));
    if (!remembered)
      return passive
        ? decline("NoPassive")
        : { next: "consent", ...base, consentedScopes };
  }
  // With shared profiles to pick from, the user chooses which one the app
  // gets, and keeps it. A passive request can't ask, and must not choose
  // for them: like a consent it can't ask for, it gets NoPassive.
  if (base.profileChoices.length > 0)
    return passive ? decline("NoPassive") : { next: "profile", ...base };
  return { next: "continue", ...base };
}

function destination(c: Context<AppEnv>, loaded: Loaded): Destination {
  return {
    idpEntityId: idpEndpoints(c.env.APP_URL).entityId,
    spEntityId: loaded.sp.entity_id,
    acsUrl: loaded.pending.acs_url,
    inResponseTo: loaded.pending.request_id,
  };
}

samlApiRoutes.get("/requests/:token", async (c) => {
  const loaded = await loadRequest(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, 404);
  const { app } = loaded;
  const ev = await evaluate(c, loaded);
  // Whether the app's domain is verified is only shown when the user is
  // asked something; otherwise the page goes straight on.
  const asks = ev.next === "consent" || ev.next === "profile";
  const verified =
    asks &&
    (await computeIsVerified(
      c.env.DB,
      app.owner_id,
      app.website_url,
      app.redirect_uris,
      app.team_id,
    ));
  return c.json({
    app: await buildConsentAppSummary(c.env, app, verified),
    next: ev.next,
    error: ev.error ?? null,
    scopes: ev.scopes,
    name_id_format: loaded.sp.name_id_format,
    user: ev.account ?? c.get("user") ?? null,
    profile: ev.profile ? profileSummary(ev.profile) : null,
    profile_choices: (ev.profileChoices ?? []).map(profileSummary),
  });
});

samlApiRoutes.post("/requests/:token", async (c) => {
  const body = await c.req
    .json<{
      action?: unknown;
      authorization_mode?: unknown;
      profile?: unknown;
    }>()
    .catch(() => ({}) as Record<string, unknown>);
  const action = body.action;
  if (action !== "approve" && action !== "deny" && action !== "decline")
    return c.json({ error: "field_invalid", params: { field: "action" } }, 400);

  const loaded = await loadRequest(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, 404);
  const { app, sp, pending } = loaded;
  const user = c.get("user");
  if (action === "approve" && !user)
    return c.json({ error: "unauthorized" }, 401);

  const ev = await evaluate(c, loaded);
  // An account that may not use the app can still deny, which sends the
  // SP a refusal instead of leaving it waiting.
  if (action === "approve" && ev.error) return c.json({ error: ev.error }, 403);
  const allowed =
    action === "deny" ||
    (action === "decline" && ev.next === "decline") ||
    (action === "approve" &&
      (ev.next === "consent" ||
        ev.next === "profile" ||
        ev.next === "continue"));
  if (!allowed) return c.json({ error: "saml_request_state" }, 409);

  const dest = destination(c, loaded);
  const now = Math.floor(Date.now() / 1000);
  const approved = action === "approve" ? (ev.account as AuthUser) : null;
  const sessionId = c.get("sessionId");
  // Without a session (nothing to sign out of later), a one-off index.
  const sessionIndex = sessionId
    ? await samlSessionIndex(sessionId, app.id)
    : `_${randomId(20)}`;
  // The ID of the user's SAML profile for this app, never the Prism user
  // ID (SAML Core §8.3.7). The first sign-in picks the profile: `profile`
  // names a shared one, or else the app gets a new per-app profile.
  const [signer, profile] = await Promise.all([
    getSamlSigner(c.env),
    approved
      ? (ev.profile ??
        bindProfile(
          c.env.DB,
          app.id,
          approved.id,
          typeof body.profile === "string" && body.profile
            ? body.profile
            : "new",
        ))
      : null,
  ]);
  if (approved && !profile)
    return c.json(
      { error: "field_invalid", params: { field: "profile" } },
      400,
    );
  const subjectId = profile?.name_id ?? "";
  const nameIdValue = approved
    ? sp.name_id_format === "email"
      ? approved.email
      : subjectId
    : "";
  const samlResponse = approved
    ? await buildSuccessResponse(
        dest,
        {
          nameId: { format: sp.name_id_format, value: nameIdValue },
          attributes: await samlAttributes(
            c.env.DB,
            approved,
            ev.scopes,
            subjectId,
          ),
          authnInstant: ev.session?.created_at ?? now,
          amr: ev.session?.amr ?? [],
          sessionIndex,
        },
        signer,
        sp.sign,
      )
    : await buildErrorResponse(
        dest,
        action === "decline" ? ev.status! : "RequestDenied",
        signer,
      );

  // One answer per request, claimed in a single write once the response is
  // built: a failure above leaves the request to retry, and of two
  // concurrent submits only one gets a response.
  const claim = await c.env.DB.prepare(
    "UPDATE saml_requests SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL",
  )
    .bind(now, pending.token_hash)
    .run();
  if (!claim.meta.changes)
    return c.json({ error: "saml_request_expired" }, 404);
  const reply = c.json({
    acs_url: pending.acs_url,
    saml_response: samlResponse,
    relay_state: pending.relay_state,
  });
  if (!approved) return reply;

  // The request is used up: whatever fails from here on, the SP still gets
  // its response, or the user would be left with no way to sign in.
  try {
    const autoAuthorize =
      body.authorization_mode === "always" && !app.is_first_party ? 1 : 0;
    // The consent row is shared with OAuth. Add SAML's scopes to it rather
    // than replace them, and never turn "Always authorize" off: a one-time
    // approval leaves a remembered consent (and its scopes) as it was.
    const consentScopes = [
      ...new Set([...(ev.consentedScopes ?? []), ...ev.scopes]),
    ];
    await Promise.all([
      // So signing out of Prism can sign the user out of this SP too.
      sessionId &&
        recordSamlSession(c.env.DB, {
          session_id: sessionId,
          app_id: app.id,
          name_id: nameIdValue,
          name_id_format: sp.name_id_format,
          session_index: sessionIndex,
        }),
      ev.next === "consent" &&
        c.env.DB.prepare(
          `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id) DO UPDATE SET
           scopes = CASE WHEN excluded.auto_authorize = 1 OR auto_authorize = 0 THEN excluded.scopes ELSE scopes END,
           auto_authorize = MAX(auto_authorize, excluded.auto_authorize),
           granted_at = excluded.granted_at`,
        )
          .bind(
            randomId(),
            approved.id,
            app.client_id,
            JSON.stringify(consentScopes),
            now,
            autoAuthorize,
          )
          .run(),
    ]);

    // The same notice and audit trail as an OAuth authorization.
    await recordAppAuthorization(c, {
      user: approved,
      app,
      scopes: ev.scopes,
      auto: ev.next !== "consent",
      protocol: "saml",
    });
  } catch (err) {
    console.error("[saml] recording a sign-in failed:", err);
  }
  return reply;
});

// ─── API for the /logout page ────────────────────────────────────────────────

/**
 * `token`: a logout another site asked for, from the /logout page URL.
 * Without one, the logout this browser began (its cookie). A begun logout
 * moves on only with that cookie: the SPs it visits never see its token,
 * and no one else can move it on or read its messages.
 */
samlApiRoutes.post("/logout", async (c) => {
  // JSON only: a form or text/plain POST needs no CORS preflight, so a page
  // on a sibling site (same-site, so the session cookie rides along) could
  // otherwise confirm a sign-out the user never saw.
  if (!c.req.header("Content-Type")?.startsWith("application/json"))
    return c.json({ error: "forbidden" }, 403);
  const body = await c.req
    .json<{ token?: unknown; action?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>);
  const bound = readSamlLogoutCookie(c);
  const token =
    typeof body.token === "string" && body.token ? body.token : (bound ?? "");
  const expired = () => c.json({ error: "saml_logout_expired" }, 404);
  let row = await loadLogout(c.env.DB, token);
  if (!row) return expired();
  let begunHere = false;

  // Another site asked for this sign-out. This request is same-site, so
  // the session cookie is here (an SP's cross-site POST had none), and only
  // this page can send it: the user confirms before the session ends.
  if (!row.started) {
    const action =
      body.action === "confirm" || body.action === "cancel"
        ? body.action
        : null;
    const user = c.get("user");
    const sessionId = c.get("sessionId");
    const account = user
      ? (await currentAccount(c.env.DB, user))?.account
      : null;
    const outcome = await beginLogout(
      c.env.DB,
      row,
      account && sessionId
        ? { sessionId, userId: account.id, email: account.email || null }
        : null,
      action,
    );
    if (outcome === "confirm") {
      const app = row.origin_app_id
        ? await c.env.DB.prepare(
            "SELECT name, icon_url FROM oauth_apps WHERE id = ?",
          )
            .bind(row.origin_app_id)
            .first<{ name: string; icon_url: string | null }>()
        : null;
      return c.json({ kind: "confirm", app: app ?? null });
    }
    if (outcome === "raced") {
      // Another tab of this browser began it first: carry on from where
      // that left it.
      if (bound !== token) return expired();
      row = await loadLogout(c.env.DB, token);
      if (!row) return expired();
    } else {
      // The SPs to visit were listed as it began.
      if (outcome === "end") await endBrowserSession(c);
      begunHere = true;
    }
  } else if (bound !== token) return expired();

  const next = await nextLogoutMessage(c.env, row);
  if (!next) return c.json({ error: "saml_logout_expired" }, 409);
  if (next.done) {
    if (bound === token) clearSamlLogoutCookie(c);
  } else if (begunHere)
    // Begun here, with SPs to visit: from now on it's this browser's.
    setSamlLogoutCookie(c, token);
  return c.json(next.message);
});
