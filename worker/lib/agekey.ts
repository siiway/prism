// AgeKey relying-party flow.
//
// Prism redirects the browser to AgeKey's OIDC implicit endpoint and gets
// back a signed id_token whose `age_thresholds` claim is a boolean per
// requested age (https://docs.agekey.org/guides/use-agekey/). The token is
// verified here — signature, issuer, audience, expiry, nonce, and the hash
// of the claims we asked for — before anything is stored.
//
// AgeKey signs with ES256 (P-256). JWS encodes that signature as raw R||S,
// which is the format WebCrypto's ECDSA verify expects.

import { AGE_THRESHOLDS } from "../../shared/age";
import { base64urlToBuf, bufToBase64url, randomBase64url } from "./crypto";

export const AGEKEY_FLOW_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 15 * 60;
const JWKS_CACHE_MS = 60 * 60 * 1000;

/** Exact claims string sent to AgeKey. The id_token's `req_claims_hash` is
 *  the base64url SHA-256 of this string, so it must not be reformatted. */
export const AGEKEY_USE_CLAIMS_JSON = '{"age_thresholds":[13,16,18,21]}';

const LIVE = {
  authorize: "https://api.agekey.org/v1/oidc/use",
  issuer: "https://api.agekey.org/v1/oidc/use",
  jwks: "https://api.agekey.org/.well-known/jwks.json",
} as const;

const TEST = {
  authorize: "https://api-test.agekey.org/v1/oidc/use",
  issuer: "https://api-test.agekey.org/v1/oidc/use",
  jwks: "https://api-test.agekey.org/.well-known/jwks.json",
} as const;

export interface AgeKeyEndpoints {
  authorize: string;
  issuer: string;
  jwks: string;
}

/** `ak_test_…` client ids talk to the AgeKey test deployment. Every other
 *  configured id uses the live service. */
export function agekeyEndpoints(clientId: string): AgeKeyEndpoints {
  return clientId.startsWith("ak_test_") ? TEST : LIVE;
}

/** Empty string clears the integration. Otherwise a short token-safe id. */
export function normalizeAgeKeyClientId(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed.length > 128 || !/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function agekeyCallbackUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/agekey/callback`;
}

const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

export function buildAgeKeyAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  language?: string;
  theme?: string;
}): string {
  const params = new URLSearchParams({
    scope: "openid",
    response_type: "id_token",
    response_mode: "fragment",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    nonce: input.nonce,
    claims: AGEKEY_USE_CLAIMS_JSON,
  });
  if (input.language && LANGUAGE.test(input.language))
    params.set("language", input.language);
  if (
    input.theme === "light" ||
    input.theme === "dark" ||
    input.theme === "system"
  )
    params.set("theme", input.theme);
  return `${agekeyEndpoints(input.clientId).authorize}?${params.toString()}`;
}

export function newAgeKeyFlowSecrets(): { state: string; nonce: string } {
  return { state: randomBase64url(32), nonce: randomBase64url(32) };
}

export class AgeKeyVerifyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AgeKeyVerifyError";
  }
}

export interface AgeKeyJwk {
  kid?: string;
  kty?: string;
  crv?: string;
  alg?: string;
  x?: string;
  y?: string;
  use?: string;
}

interface JwksCacheEntry {
  keys: AgeKeyJwk[];
  expiresAt: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();

export function clearAgeKeyJwksCache(): void {
  jwksCache.clear();
}

function isKnownJwksUrl(url: string): boolean {
  return url === LIVE.jwks || url === TEST.jwks;
}

export async function fetchAgeKeyJwks(
  url: string,
  refresh = false,
): Promise<AgeKeyJwk[]> {
  if (!isKnownJwksUrl(url)) throw new AgeKeyVerifyError("jwks");
  const now = Date.now();
  const hit = jwksCache.get(url);
  if (!refresh && hit && hit.expiresAt > now) return hit.keys;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new AgeKeyVerifyError("jwks");
  const body = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new AgeKeyVerifyError("jwks");
  const keys = body.keys.filter(isAgeKeyJwk);
  jwksCache.set(url, { keys, expiresAt: now + JWKS_CACHE_MS });
  return keys;
}

function isAgeKeyJwk(value: unknown): value is AgeKeyJwk {
  if (!value || typeof value !== "object") return false;
  const jwk = value as AgeKeyJwk;
  return (
    typeof jwk.kid === "string" &&
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    typeof jwk.x === "string" &&
    typeof jwk.y === "string" &&
    (jwk.alg === undefined || jwk.alg === "ES256") &&
    (jwk.use === undefined || jwk.use === "sig")
  );
}

export async function hashClaimsJson(claimsJson: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(claimsJson),
  );
  return bufToBase64url(digest);
}

function canonicalB64url(value: string): string {
  return value.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeJsonPart(part: string): Record<string, unknown> {
  const text = new TextDecoder().decode(base64urlToBuf(part));
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new AgeKeyVerifyError("malformed");
  return parsed as Record<string, unknown>;
}

function audienceMatches(aud: unknown, clientId: string): boolean {
  if (typeof aud === "string") return aud === clientId;
  if (Array.isArray(aud)) return aud.some((entry) => entry === clientId);
  return false;
}

export interface VerifiedAgeKey {
  sessionId: string;
  thresholds: Record<string, boolean>;
}

/** Verify an AgeKey id_token against an already-fetched JWKS. `now` is unix
 *  seconds so tests can pin the clock. */
export async function verifyAgeKeyToken(input: {
  token: string;
  clientId: string;
  nonce: string;
  claimsJson: string;
  now: number;
  jwks: AgeKeyJwk[];
}): Promise<VerifiedAgeKey> {
  if (input.token.length > 8192) throw new AgeKeyVerifyError("malformed");
  const parts = input.token.split(".");
  if (parts.length !== 3) throw new AgeKeyVerifyError("malformed");
  const [headerPart, bodyPart, sigPart] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJsonPart(headerPart);
    payload = decodeJsonPart(bodyPart);
  } catch (err) {
    if (err instanceof AgeKeyVerifyError) throw err;
    throw new AgeKeyVerifyError("malformed");
  }

  if (header.alg !== "ES256") throw new AgeKeyVerifyError("alg");
  if (header.typ !== undefined && header.typ !== "JWT")
    throw new AgeKeyVerifyError("malformed");
  if (typeof header.kid !== "string" || header.kid.length === 0)
    throw new AgeKeyVerifyError("malformed");

  const jwk = input.jwks.find((key) => key.kid === header.kid);
  if (!jwk) throw new AgeKeyVerifyError("unknown_kid");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64urlToBuf(sigPart),
    new TextEncoder().encode(`${headerPart}.${bodyPart}`),
  );
  if (!valid) throw new AgeKeyVerifyError("signature");

  const issuer = agekeyEndpoints(input.clientId).issuer;
  if (payload.iss !== issuer) throw new AgeKeyVerifyError("issuer");
  if (!audienceMatches(payload.aud, input.clientId))
    throw new AgeKeyVerifyError("audience");
  if (payload.nonce !== input.nonce) throw new AgeKeyVerifyError("nonce");

  const iat = payload.iat;
  const exp = payload.exp;
  if (typeof iat !== "number" || typeof exp !== "number")
    throw new AgeKeyVerifyError("expired");
  if (exp + CLOCK_SKEW_SECONDS < input.now)
    throw new AgeKeyVerifyError("expired");
  if (iat > input.now + CLOCK_SKEW_SECONDS)
    throw new AgeKeyVerifyError("expired");
  if (exp <= iat || exp - iat > MAX_TOKEN_LIFETIME_SECONDS)
    throw new AgeKeyVerifyError("expired");
  if (
    typeof payload.nbf === "number" &&
    payload.nbf > input.now + CLOCK_SKEW_SECONDS
  )
    throw new AgeKeyVerifyError("expired");

  const expectedHash = await hashClaimsJson(input.claimsJson);
  if (
    typeof payload.req_claims_hash !== "string" ||
    canonicalB64url(payload.req_claims_hash) !== canonicalB64url(expectedHash)
  )
    throw new AgeKeyVerifyError("claims_hash");

  if (input.claimsJson !== AGEKEY_USE_CLAIMS_JSON)
    throw new AgeKeyVerifyError("claims");

  const raw = payload.age_thresholds;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AgeKeyVerifyError("thresholds");
  const thresholds: Record<string, boolean> = {};
  for (const threshold of AGE_THRESHOLDS) {
    const value = (raw as Record<string, unknown>)[String(threshold)];
    if (typeof value !== "boolean") throw new AgeKeyVerifyError("thresholds");
    thresholds[String(threshold)] = value;
  }

  const sessionId = payload.sub;
  if (
    typeof sessionId !== "string" ||
    sessionId.length < 1 ||
    sessionId.length > 200
  )
    throw new AgeKeyVerifyError("subject");

  return { sessionId, thresholds };
}

export type AgeVerificationSource = "agekey" | "admin";

export interface AgeVerification {
  sessionId: string;
  thresholds: Record<string, boolean>;
  verifiedAt: number;
  source: AgeVerificationSource;
}

/** Session id stored for an operator override. Unique per user, and distinct
 *  from an AgeKey `sub`, so it cannot be mistaken for a signed session. */
export function adminAgeSessionId(userId: string): string {
  return `admin:${userId}`;
}

function readSource(value: string | null | undefined): AgeVerificationSource {
  return value === "admin" ? "admin" : "agekey";
}

export function parseStoredThresholds(json: string): Record<string, boolean> {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, boolean> = {};
    for (const threshold of AGE_THRESHOLDS) {
      const value = (raw as Record<string, unknown>)[String(threshold)];
      if (value === true || value === false) out[String(threshold)] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function getAgeVerification(
  db: D1Database,
  userId: string,
): Promise<AgeVerification | null> {
  const row = await db
    .prepare(
      "SELECT session_id, thresholds, verified_at, source FROM age_verifications WHERE user_id = ?",
    )
    .bind(userId)
    .first<{
      session_id: string;
      thresholds: string;
      verified_at: number;
      source: string;
    }>();
  if (!row) return null;
  return {
    sessionId: row.session_id,
    thresholds: parseStoredThresholds(row.thresholds),
    verifiedAt: row.verified_at,
    source: readSource(row.source),
  };
}

export interface NewAgeKeyFlow {
  state: string;
  userId: string;
  nonce: string;
  claimsJson: string;
  clientId: string;
  now: number;
}

export async function beginAgeKeyFlow(
  db: D1Database,
  input: NewAgeKeyFlow,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM agekey_flows WHERE user_id = ?").bind(input.userId),
    db
      .prepare(
        `DELETE FROM agekey_flows
          WHERE state IN (
            SELECT state FROM agekey_flows WHERE expires_at <= ? LIMIT 100
          )`,
      )
      .bind(input.now),
    db
      .prepare(
        `INSERT INTO agekey_flows
           (state, user_id, nonce, claims_json, client_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.state,
        input.userId,
        input.nonce,
        input.claimsJson,
        input.clientId,
        input.now + AGEKEY_FLOW_TTL_SECONDS,
        input.now,
      ),
  ]);
}

export interface AgeKeyFlow {
  state: string;
  userId: string;
  nonce: string;
  claimsJson: string;
  clientId: string;
}

const FLOW_STATE = /^[A-Za-z0-9_-]{43}$/;

/** Redeem the flow exactly once. Expired or unknown states return null. */
export async function consumeAgeKeyFlow(
  db: D1Database,
  state: string,
  now: number,
): Promise<AgeKeyFlow | null> {
  if (!FLOW_STATE.test(state)) return null;
  const row = await db
    .prepare(
      `DELETE FROM agekey_flows
        WHERE state = ? AND expires_at > ?
        RETURNING state, user_id, nonce, claims_json, client_id`,
    )
    .bind(state, now)
    .first<{
      state: string;
      user_id: string;
      nonce: string;
      claims_json: string;
      client_id: string;
    }>();
  if (!row) return null;
  return {
    state: row.state,
    userId: row.user_id,
    nonce: row.nonce,
    claimsJson: row.claims_json,
    clientId: row.client_id,
  };
}

export async function upsertAgeVerification(
  db: D1Database,
  userId: string,
  sessionId: string,
  thresholds: Record<string, boolean>,
  verifiedAt: number,
  source: AgeVerificationSource = "agekey",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO age_verifications
         (user_id, session_id, thresholds, verified_at, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         session_id = excluded.session_id,
         thresholds = excluded.thresholds,
         verified_at = excluded.verified_at,
         source = excluded.source`,
    )
    .bind(userId, sessionId, JSON.stringify(thresholds), verifiedAt, source)
    .run();
}

export async function deleteAgeVerification(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM age_verifications WHERE user_id = ?")
    .bind(userId)
    .run();
}
