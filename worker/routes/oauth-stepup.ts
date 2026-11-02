// Step-up 2FA during authorization: when an app requires a second factor at
// consent time, the code is withheld until the user verifies with TOTP or a
// passkey through these endpoints.

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { turnstileEndpointFor, type TurnstileVariant } from "../lib/turnstile";
import { buildPublicCaptcha } from "../lib/captchaPublic";
import { hashSecret, hashLookupCandidate } from "../lib/secretCrypto";
import { randomBase64url, verifyPkce } from "../lib/crypto";
import { verifyAnyTotp } from "../lib/totp";
import { sudoKvKey, isSudoActive, grantSudo } from "../lib/sudo";
import { rateLimit } from "../middleware/rateLimit";
import { captchaRefusal } from "../middleware/captcha";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { computeIsVerified } from "../lib/domainVerify";
import {
  parseRedirectUris,
  redirectUriMatchesRegistered,
} from "../lib/redirectUri";
import type { OAuthAppRow, Variables } from "../types";
import {
  authenticateClient,
  buildConsentAppSummary,
  readOAuthBody,
} from "../lib/oauthClients";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Step-up 2FA authorization ───────────────────────────────────────────────
// Apps confirm sensitive actions by:
//   1. Server-to-server: POST /api/oauth/2fa/challenges with { action,
//      redirect_uri, nonce?, code_challenge? } authenticated by client_secret
//      (or, for public clients, just code_challenge). Receives challenge_id.
//   2. Redirect user to /oauth/2fa?challenge_id=<id>&state=<state>. The URL
//      carries no other parameters — a phisher cannot inject arbitrary
//      action text or pick an arbitrary redirect URI because those are fixed
//      at step 1, which they cannot reach without the app's credentials.
//   3. User completes TOTP or passkey on the Prism consent page; the page
//      requires explicit acknowledgment of the action text.
//   4. Prism redirects back to the challenge's stored redirect_uri with
//      ?code=...&state=...
//   5. App exchanges the code at /api/oauth/2fa/verify (PKCE or client secret)
//      to receive { user_id, verified_at, action, nonce, method }.

// Friendly redirect for direct hits — sends users to the SPA route.
app.get("/2fa", (c) => {
  const qs = new URL(c.req.url).search;
  return c.redirect(`/oauth/2fa${qs}`, 302);
});

// Caps so a malicious app can't smuggle a giant blob into the consent UI to
// scroll legitimate content off-screen, or hide a payload in echoed-back
// `nonce`/`action` fields.
const MAX_2FA_ACTION_LEN = 200;
const MAX_2FA_NONCE_LEN = 256;
const MAX_2FA_STATE_LEN = 512;

// Sudo helpers are shared with admin reset flow; see lib/sudo.ts.

// POST /api/oauth/2fa/challenges — server-to-server challenge creation.
// This is the only path that can pin an `action`/`redirect_uri` to a 2FA
// prompt: the user-facing URL only carries an opaque `challenge_id`, so a
// phisher who controls only a URL cannot inject arbitrary action text.
app.post("/2fa/challenges", async (c) => {
  const { params, json } = await readOAuthBody(c);
  // JSON may carry require_captcha as a real boolean; a form sends a string.
  const rawRequireCaptcha: unknown = json
    ? json.require_captcha
    : params.require_captcha;

  const auth = await authenticateClient(c, params);
  if (!auth.ok)
    return auth.badRequest
      ? c.json({ error: "invalid_request" }, 400)
      : c.json({ error: "invalid_client" }, 401);
  const oauthApp = auth.app;
  const clientId = oauthApp.client_id;

  const { redirect_uri, action, nonce, code_challenge, code_challenge_method } =
    params;

  if (!redirect_uri) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const redirectUris = parseRedirectUris(oauthApp.redirect_uris);
  if (!redirectUriMatchesRegistered(redirect_uri, redirectUris)) {
    return c.json({ error: "invalid_redirect_uri" }, 400);
  }

  // Public clients have no secret, so PKCE is the only way to bind the
  // verify call back to whoever created the challenge.
  if (oauthApp.is_public === 1 && !code_challenge) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "code_challenge is required for public clients",
      },
      400,
    );
  }

  if (action && action.length > MAX_2FA_ACTION_LEN) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (nonce && nonce.length > MAX_2FA_NONCE_LEN) {
    return c.json({ error: "invalid_request" }, 400);
  }

  // Per-client throttle — a compromised public client (or a leaked secret)
  // shouldn't be able to mint unlimited challenges to spam users. 60/min is
  // far above any legitimate use.
  const rl = await rateLimit(c.env.DB, `2fa-challenges:${clientId}`, 60, 60);
  if (!rl.allowed) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = randomBase64url(32);
  const expiresAt = now + 900; // 15-minute window for the user to complete

  // Accept JSON booleans as well as form-encoded strings.
  const requireCaptchaFlag =
    rawRequireCaptcha === true ||
    rawRequireCaptcha === "true" ||
    rawRequireCaptcha === "1"
      ? 1
      : 0;

  await c.env.DB.prepare(
    `INSERT INTO oauth_2fa_challenges (id, client_id, redirect_uri, action, nonce, code_challenge, code_challenge_method, expires_at, created_at, require_captcha)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      clientId,
      redirect_uri,
      action ?? null,
      nonce ?? null,
      code_challenge ?? null,
      code_challenge_method ?? null,
      expiresAt,
      now,
      requireCaptchaFlag,
    )
    .run();

  return c.json({
    challenge_id: id,
    expires_at: expiresAt,
    url: `${c.env.APP_URL}/oauth/2fa?challenge_id=${encodeURIComponent(id)}`,
  });
});

// GET /api/oauth/2fa/info — consent screen data, looked up by challenge_id.
app.get("/2fa/info", optionalAuth, async (c) => {
  const { challenge_id, state } = c.req.query();

  if (!challenge_id) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (state && state.length > MAX_2FA_STATE_LEN) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const challenge = await c.env.DB.prepare(
    "SELECT * FROM oauth_2fa_challenges WHERE id = ?",
  )
    .bind(challenge_id)
    .first<import("../types").OAuth2FAChallengeRow>();
  if (!challenge) return c.json({ error: "invalid_challenge" }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (challenge.expires_at < now)
    return c.json({ error: "challenge_expired" }, 400);
  if (challenge.consumed_at)
    return c.json({ error: "challenge_consumed" }, 400);

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(challenge.client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  const isVerified = await computeIsVerified(
    c.env.DB,
    oauthApp.owner_id,
    oauthApp.website_url,
    oauthApp.redirect_uris,
    oauthApp.team_id,
  );

  // Show what 2FA methods this user has enrolled.
  let totpEnrolled = false;
  let passkeyEnrolled = false;
  let backupCodesAvailable = false;
  let sudoActive = false;
  const currentUser = c.get("user");
  const sessionId = c.get("sessionId");
  if (currentUser) {
    const [totpRow, passkeyRow, recoveryRow, sudo] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id FROM totp_authenticators WHERE user_id = ? AND enabled = 1 LIMIT 1",
      )
        .bind(currentUser.id)
        .first<{ id: string }>(),
      c.env.DB.prepare(
        "SELECT credential_id FROM passkeys WHERE user_id = ? LIMIT 1",
      )
        .bind(currentUser.id)
        .first<{ credential_id: string }>(),
      c.env.DB.prepare(
        "SELECT user_id FROM user_totp_recovery WHERE user_id = ?",
      )
        .bind(currentUser.id)
        .first<{ user_id: string }>(),
      sessionId
        ? isSudoActive(
            c.env.KV_CACHE,
            currentUser.id,
            sessionId,
            challenge.client_id,
          )
        : Promise.resolve(false),
    ]);
    totpEnrolled = !!totpRow;
    passkeyEnrolled = !!passkeyRow;
    backupCodesAvailable = !!recoveryRow;
    sudoActive = sudo;
  }

  const config = await getConfig(c.env.DB);

  // Captcha is required if either the site default or the per-challenge flag
  // is set, AND a captcha provider is actually configured. Sudo bypass skips
  // captcha — there's no factor being checked, so no brute-force surface.
  const captchaRequired =
    (config.require_captcha_for_2fa || challenge.require_captcha === 1) &&
    config.captcha_providers.some((p) => p !== "none") &&
    !sudoActive;

  // The widget is only rendered when a captcha is actually required, so skip
  // the China probe entirely when it is not.
  const turnstile = captchaRequired
    ? await turnstileEndpointFor(c, config)
    : { directive: "global" as const, chinaSiteKey: "" };

  return c.json({
    app: await buildConsentAppSummary(c.env, oauthApp, isVerified),
    challenge_id,
    redirect_uri: challenge.redirect_uri,
    state: state ?? null,
    action: challenge.action,
    expires_at: challenge.expires_at,
    user: c.get("user") ?? null,
    totp_enrolled: totpEnrolled,
    passkey_enrolled: passkeyEnrolled,
    backup_codes_available: backupCodesAvailable,
    has_any_2fa: totpEnrolled || passkeyEnrolled,
    sudo_active: sudoActive,
    sudo_ttl_minutes: config.sudo_mode_ttl_minutes,
    captcha_required: captchaRequired,
    captcha: buildPublicCaptcha(
      config,
      turnstile.directive,
      turnstile.chinaSiteKey,
      captchaRequired ? config.captcha_providers : [],
    ),
  });
});

// POST /api/oauth/2fa/authorize — user approves with TOTP/passkey or denies.
// On approve: returns { redirect } where the redirect URL carries the code.
//
// Sudo mode interaction:
//   - `use_sudo: true` — bypass the TOTP/passkey check by drawing on a
//     prior successful 2FA in this same session for this same client.
//     Refused if no sudo grant is active or if `sudo_mode_ttl_minutes` is 0.
//   - `enable_sudo: true` (with a real TOTP/passkey, not `use_sudo`) — on
//     success, grant a sudo window for this (user, session, client) tuple.
app.post("/2fa/authorize", requireAuth, async (c) => {
  const user = c.get("user");
  const sessionId = c.get("sessionId");
  const body = await c.req.json<{
    challenge_id: string;
    state?: string;
    decision: "approve" | "deny";
    totp_code?: string;
    passkey_verify_token?: string;
    enable_sudo?: boolean;
    use_sudo?: boolean;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    pow_challenge?: string;
    pow_nonce?: number;
  }>();

  if (!body.challenge_id) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (body.state && body.state.length > MAX_2FA_STATE_LEN) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const challenge = await c.env.DB.prepare(
    "SELECT * FROM oauth_2fa_challenges WHERE id = ?",
  )
    .bind(body.challenge_id)
    .first<import("../types").OAuth2FAChallengeRow>();
  if (!challenge) return c.json({ error: "invalid_challenge" }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (challenge.expires_at < now)
    return c.json({ error: "challenge_expired" }, 400);
  if (challenge.consumed_at)
    return c.json({ error: "challenge_consumed" }, 400);

  const config = await getConfig(c.env.DB);
  const sudoTtlMinutes = Math.max(0, config.sudo_mode_ttl_minutes);

  // Captcha gate runs BEFORE consuming the challenge, so a user who failed
  // captcha can retry with a fresh token without losing the challenge. We
  // skip captcha on the sudo bypass path: there's no factor being checked,
  // so no anti-bot value, and forcing it would defeat the "frictionless"
  // point of sudo.
  const captchaRequired =
    !body.use_sudo &&
    (config.require_captcha_for_2fa || challenge.require_captcha === 1) &&
    config.captcha_providers.some((p) => p !== "none");
  if (captchaRequired && body.decision === "approve") {
    if (await captchaRefusal(c, body)) {
      return c.json(
        {
          error: "captcha_failed",
        },
        400,
      );
    }
  }

  // Atomically mark the challenge consumed so concurrent requests can't
  // both succeed. Whoever loses the race sees challenge_consumed.
  const consumed = await c.env.DB.prepare(
    "UPDATE oauth_2fa_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
  )
    .bind(now, body.challenge_id)
    .run();
  if (!consumed.meta.changes) {
    return c.json({ error: "challenge_consumed" }, 400);
  }

  if (body.decision === "deny") {
    const url = new URL(challenge.redirect_uri);
    url.searchParams.set("error", "access_denied");
    if (body.state) url.searchParams.set("state", body.state);
    return c.json({ redirect: url.toString() });
  }

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(challenge.client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  let method: "totp" | "passkey" | "backup" | "sudo" | null = null;

  // Sudo path — bypass TOTP/passkey if the user opted into sudo earlier in
  // this session for this same client. The KV record is the proof.
  if (body.use_sudo) {
    if (sudoTtlMinutes === 0) {
      return c.json(
        {
          error: "sudo_disabled",
        },
        400,
      );
    }
    if (
      sessionId &&
      (await isSudoActive(
        c.env.KV_CACHE,
        user.id,
        sessionId,
        challenge.client_id,
      ))
    ) {
      method = "sudo";
    } else {
      return c.json(
        {
          error: "sudo_inactive",
        },
        400,
      );
    }
  } else {
    // Normal path: rate-limit and verify TOTP / passkey.
    const rl = await rateLimit(c.env.DB, `2fa-stepup:${user.id}`, 8, 300);
    if (!rl.allowed) {
      return c.json(
        {
          error: "rate_limited",
        },
        429,
      );
    }

    if (body.passkey_verify_token) {
      const kvKey = `passkey_site_verify:${user.id}:${body.passkey_verify_token}`;
      const stored = await c.env.KV_CACHE.get(kvKey);
      if (stored) {
        await c.env.KV_CACHE.delete(kvKey);
        method = "passkey";
      }
    } else if (body.totp_code) {
      if (await verifyAnyTotp(c.env, user.id, body.totp_code)) {
        method = "totp";
      }
    }

    if (!method) {
      return c.json(
        {
          error: "invalid_2fa",
        },
        400,
      );
    }

    // Successful real 2FA — optionally grant a sudo window for this session
    // and client. We don't grant on the sudo bypass path: only fresh proof
    // of factor extends the window.
    if (body.enable_sudo && sessionId && sudoTtlMinutes > 0) {
      await grantSudo(
        c.env.KV_CACHE,
        user.id,
        sessionId,
        challenge.client_id,
        sudoTtlMinutes,
      );
    }
  }

  // Persist which method was used (including "sudo") so the verifying app
  // can decide whether to accept a sudo-bypassed confirmation for the action.
  // Apps performing very high-stakes operations should require method !== "sudo".
  const code = randomBase64url(32);
  const storedCode = await hashSecret(c.env, code);
  await c.env.DB.prepare(
    `INSERT INTO oauth_2fa_codes (code, client_id, user_id, redirect_uri, action, nonce, method, code_challenge, code_challenge_method, expires_at, verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      storedCode,
      challenge.client_id,
      user.id,
      challenge.redirect_uri,
      challenge.action,
      challenge.nonce,
      method,
      challenge.code_challenge,
      challenge.code_challenge_method,
      now + 300, // 5-minute TTL — short window between user click and app verify
      now,
      now,
    )
    .run();

  const url = new URL(challenge.redirect_uri);
  url.searchParams.set("code", code);
  if (body.state) url.searchParams.set("state", body.state);

  return c.json({ redirect: url.toString() });
});

// POST /api/oauth/2fa/sudo/revoke — drop the active sudo window for one app
// in this session. Lets a user "log out" of sudo for a given client ahead
// of its TTL. (Logging out of Prism rotates the session id, so all sudo
// grants for that session naturally become unreachable.)
app.post("/2fa/sudo/revoke", requireAuth, async (c) => {
  const user = c.get("user");
  const sessionId = c.get("sessionId");
  if (!sessionId) return c.json({ revoked: false });

  const body = await c.req
    .json<{ client_id?: string }>()
    .catch(() => ({}) as { client_id?: string });
  if (!body.client_id) {
    return c.json({ error: "invalid_request" }, 400);
  }

  await c.env.KV_CACHE.delete(sudoKvKey(user.id, sessionId, body.client_id));
  return c.json({ revoked: true });
});

// POST /api/oauth/2fa/verify — app exchanges the single-use code for the
// verification result. Form-encoded or JSON body. Auth via PKCE (public
// clients) or HTTP Basic / client_secret (confidential clients), mirroring
// the /token endpoint.
app.post("/2fa/verify", async (c) => {
  const { params } = await readOAuthBody(c);
  const { code, redirect_uri, code_verifier } = params;
  if (!code || !redirect_uri) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const auth = await authenticateClient(c, params);
  if (!auth.ok)
    return auth.badRequest
      ? c.json({ error: "invalid_request" }, 400)
      : c.json({ error: "invalid_client" }, 401);
  const oauthApp = auth.app;
  const clientId = oauthApp.client_id;

  const codeLookup = await hashLookupCandidate(c.env, code);
  if (!codeLookup) return c.json({ error: "invalid_grant" }, 400);
  const codeRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_2fa_codes WHERE code = ? OR code = ?",
  )
    .bind(code, codeLookup)
    .first<import("../types").OAuth2FACodeRow>();
  // Bind the code to (client_id, redirect_uri) before any other check so a
  // stolen code is useless to a different app or sent to a different URI.
  if (!codeRow || codeRow.client_id !== clientId)
    return c.json({ error: "invalid_grant" }, 400);
  if (codeRow.redirect_uri !== redirect_uri)
    return c.json({ error: "invalid_grant" }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (codeRow.used_at)
    return c.json(
      { error: "invalid_grant", error_description: "Code already used" },
      400,
    );
  if (codeRow.expires_at < now)
    return c.json(
      { error: "invalid_grant", error_description: "Code expired" },
      400,
    );

  if (oauthApp.is_public && !codeRow.code_challenge) {
    return c.json(
      {
        error: "invalid_grant",
        error_description: "PKCE is required for public clients",
      },
      400,
    );
  }

  if (codeRow.code_challenge) {
    if (!code_verifier)
      return c.json(
        {
          error: "invalid_grant",
          error_description: "code_verifier required",
        },
        400,
      );
    const pkceOk = await verifyPkce(
      code_verifier,
      codeRow.code_challenge,
      codeRow.code_challenge_method ?? "S256",
    );
    if (!pkceOk)
      return c.json(
        {
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        },
        400,
      );
  }

  // Mark single-use. Conditional UPDATE so a concurrent verify can't redeem
  // the same code twice — losers see invalid_grant on the recheck.
  const updated = await c.env.DB.prepare(
    "UPDATE oauth_2fa_codes SET used_at = ? WHERE code = ? AND used_at IS NULL",
  )
    .bind(now, codeRow.code)
    .run();
  if (!updated.meta.changes) {
    return c.json(
      { error: "invalid_grant", error_description: "Code already used" },
      400,
    );
  }

  return c.json({
    user_id: codeRow.user_id,
    client_id: codeRow.client_id,
    verified_at: codeRow.verified_at,
    action: codeRow.action,
    nonce: codeRow.nonce,
    method: codeRow.method,
  });
});

export default app;
