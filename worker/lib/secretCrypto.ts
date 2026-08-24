// Envelope encryption + keyed hashing for sensitive fields stored in D1.
//
// Most "secrets" in this codebase — OAuth app client_secret, OAuth source
// (external IdP) client_secret, captcha secret keys, SMTP/IMAP passwords,
// the GitHub README site PAT, etc. — used to live in plaintext. This
// module wraps them with AES-GCM using a master key sourced from a
// Cloudflare Secrets Store binding (`env.SECRETS_KEY`).
//
// Bearer-style secrets that need indexed lookup (PATs, OAuth tokens, OAuth
// codes, invite tokens, email-verify tokens, 2FA codes/nonces, individual
// backup codes) cannot be encrypted at rest with AES-GCM and still be
// looked up by value — AES-GCM is non-deterministic. Those use the
// `hashSecret` path instead: a deterministic HMAC-SHA256 keyed by an
// HKDF-derived subkey of the master key. The plaintext is never
// recoverable; the user-supplied candidate is hashed and compared
// against the stored hash.
//
// Design choices:
//   - Single binding. Per-secret bindings don't scale to dynamic rows
//     (admins create OAuth sources / users create OAuth apps at runtime).
//     A site-wide master key + envelope encryption is the standard
//     pattern for this.
//   - Optional binding. If `env.SECRETS_KEY` is absent, encryptSecret /
//     hashSecret are no-ops (return plaintext) and the inverse helpers
//     short-circuit any value lacking the prefix. This keeps the legacy
//     plaintext path working until an admin runs the migrate flow.
//   - Self-describing format: ciphertext rows start with `__ENC_v1__`
//     and hash rows start with `__HASH_v1__` so we can tell at-a-glance
//     what shape a row is in. Real tokens / codes / passwords are random
//     alphanumeric and never start with `__`.
//   - Idempotent: encryptSecret / hashSecret on already-transformed
//     input return it unchanged so the migration job can be re-run.
//   - Domain-separated subkey: hashing uses an HKDF-derived HMAC subkey
//     ("prism:hash-subkey:v1") rather than the raw master key, so the
//     same master can safely serve both AES-GCM and HMAC-SHA256.

const ENC_PREFIX = "__ENC_v1__";
const HASH_PREFIX = "__HASH_v1__";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const HASH_SUBKEY_INFO = "prism:hash-subkey:v1";

/** Site-config keys whose values must be encrypted at rest. Anything
 *  missing from this list is stored as-is. Keep this list aligned with
 *  the admin migrate endpoint — it iterates the same set. */
export const SENSITIVE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "captcha_secret_key",
  "turnstile_china_secret_key",
  "github_client_secret",
  "google_client_secret",
  "microsoft_client_secret",
  "discord_client_secret",
  "email_api_key",
  "imap_password",
  "smtp_password",
  "github_readme_token",
  "discord_bot_token",
]);

interface KeyPair {
  aes: CryptoKey;
  hmac: CryptoKey;
}

let cachedKeys: Promise<KeyPair> | null = null;

/** Reset cached keys — used by tests and the admin "I rotated the master
 *  key" flow. Not exported elsewhere because the binding is read-only. */
export function resetSecretsKeyCache(): void {
  cachedKeys = null;
}

async function getKeys(env: Env): Promise<KeyPair> {
  if (!env.SECRETS_KEY) {
    throw new Error("SECRETS_KEY binding is not configured");
  }
  if (!cachedKeys) {
    cachedKeys = (async () => {
      const raw = await env.SECRETS_KEY!.get();
      if (!raw) throw new Error("SECRETS_KEY value is empty");
      const bytes = base64UrlToBytes(raw.trim());
      if (!bytes || bytes.length !== KEY_LENGTH) {
        throw new Error(
          `SECRETS_KEY must be ${KEY_LENGTH} bytes encoded as base64url`,
        );
      }
      // AES key is imported from the raw master bytes directly so any
      // ciphertext written before the HMAC subkey existed remains
      // decryptable byte-for-byte.
      const aes = await crypto.subtle.importKey(
        "raw",
        bytes,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
      // HMAC subkey is derived via HKDF for domain separation. Salt is
      // empty (HKDF spec allows this); the info string pins the use to
      // hashing v1 so any future variants (e.g. a different hash
      // construction) get a different subkey.
      const hkdfMaterial = await crypto.subtle.importKey(
        "raw",
        bytes,
        "HKDF",
        false,
        ["deriveBits"],
      );
      const hmacBits = await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new Uint8Array(0),
          info: new TextEncoder().encode(HASH_SUBKEY_INFO),
        },
        hkdfMaterial,
        256,
      );
      const hmac = await crypto.subtle.importKey(
        "raw",
        hmacBits,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return { aes, hmac };
    })();
  }
  return cachedKeys;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

export function isHashedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(HASH_PREFIX);
}

/** True when a value LOOKS like an internal stored representation (cipher
 *  or hash). Use this to reject candidate inputs from the wire — no real
 *  user-facing token/code/password starts with `__`, so a candidate that
 *  does is either a probe or accidental copy-paste of stored material. */
export function looksLikeStoredSecret(
  value: string | null | undefined,
): boolean {
  return isEncryptedSecret(value) || isHashedSecret(value);
}

export function isSecretsKeyConfigured(env: Env): boolean {
  return !!env.SECRETS_KEY;
}

/** Encrypt a plaintext secret. No-op when:
 *   - value is null/empty (returned as-is)
 *   - value is already encrypted (returned as-is — idempotent)
 *   - SECRETS_KEY is not bound (returned as-is — legacy path)
 */
export async function encryptSecret(
  env: Env,
  plaintext: string | null | undefined,
): Promise<string | null> {
  if (plaintext == null || plaintext === "") {
    return (plaintext as string | null) ?? null;
  }
  if (isEncryptedSecret(plaintext)) return plaintext;
  if (!env.SECRETS_KEY) return plaintext;

  const { aes } = await getKeys(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aes,
      new TextEncoder().encode(plaintext),
    ),
  );
  return `${ENC_PREFIX}${bytesToBase64Url(iv)}:${bytesToBase64Url(ct)}`;
}

/** Decrypt a stored secret. No-op when:
 *   - value is null (returned as-is)
 *   - value is not encrypted (returned as-is — legacy plaintext)
 *
 * Throws when value LOOKS encrypted but the binding is unavailable or the
 * key can't decrypt it (key rotation/loss). Callers should treat that as
 * "fail closed" rather than silently using a malformed value.
 */
export async function decryptSecret(
  env: Env,
  value: string | null | undefined,
): Promise<string | null> {
  if (value == null) return null;
  if (!isEncryptedSecret(value)) return value;

  if (!env.SECRETS_KEY) {
    throw new Error(
      "Encrypted secret encountered but SECRETS_KEY binding is not configured",
    );
  }

  const rest = value.slice(ENC_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new Error("Malformed encrypted secret");
  const iv = base64UrlToBytes(rest.slice(0, sep));
  const ct = base64UrlToBytes(rest.slice(sep + 1));
  if (!iv || !ct) throw new Error("Malformed encrypted secret");

  const { aes } = await getKeys(env);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ct),
  );
  return new TextDecoder().decode(pt);
}

/** Hash a plaintext secret with the keyed HMAC-SHA256 subkey. Output is
 *  deterministic for a given (key, input), which is what makes indexed
 *  lookup possible. No-op when:
 *    - value is null/empty (returned as-is)
 *    - value is already hashed (returned as-is — idempotent)
 *    - SECRETS_KEY is not bound (returned as-is — legacy plaintext)
 *
 *  Use for bearer-style tokens where the server only ever needs to
 *  verify (not recover) the original value: PATs, OAuth tokens, OAuth
 *  codes, invite tokens, email-verify codes, 2FA codes, backup codes.
 */
export async function hashSecret(
  env: Env,
  plaintext: string | null | undefined,
): Promise<string | null> {
  if (plaintext == null || plaintext === "") {
    return (plaintext as string | null) ?? null;
  }
  if (isHashedSecret(plaintext)) return plaintext;
  if (!env.SECRETS_KEY) return plaintext;

  const { hmac } = await getKeys(env);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(plaintext)),
  );
  return `${HASH_PREFIX}${bytesToBase64Url(sig)}`;
}

/** Hash a user-supplied candidate so it can be used in a `WHERE col = ?`
 *  lookup against a hashed column. Returns null when the candidate is
 *  null/empty or LOOKS like a stored cipher/hash (rejecting suspicious
 *  inputs prevents an attacker from submitting a stored hash directly
 *  and matching the row by exact-string compare in the legacy plaintext
 *  fallback clause).
 *
 *  When SECRETS_KEY is unbound this returns the candidate unchanged so
 *  legacy plaintext lookups continue working.
 *
 *  Use the OR-pattern at lookup sites:
 *      WHERE col = ? OR col = ?
 *      bind(rawCandidate, await hashLookupCandidate(env, rawCandidate))
 *  so unmigrated plaintext rows and migrated hashed rows both match.
 */
export async function hashLookupCandidate(
  env: Env,
  candidate: string | null | undefined,
): Promise<string | null> {
  if (typeof candidate !== "string" || candidate === "") return null;
  if (looksLikeStoredSecret(candidate)) return null;
  if (!env.SECRETS_KEY) return candidate;
  const { hmac } = await getKeys(env);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(candidate)),
  );
  return `${HASH_PREFIX}${bytesToBase64Url(sig)}`;
}

/** Constant-time comparison: hashes the candidate and compares to the
 *  stored hash. Falls back to direct string compare when the stored
 *  value is legacy plaintext, so verification still works on rows that
 *  haven't been migrated yet. */
export async function timingSafeHashEqual(
  env: Env,
  stored: string | null | undefined,
  candidate: string,
): Promise<boolean> {
  if (!stored || !candidate) return false;
  const expected = isHashedSecret(stored) ? stored : stored; // plaintext path: compare directly below
  const actual = isHashedSecret(stored)
    ? ((await hashSecret(env, candidate)) ?? "")
    : candidate;
  return constantTimeStringEqual(expected, actual);
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let acc = 1;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      acc |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return acc === 0;
  }
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

/** Constant-time comparison helper that decrypts the stored value first.
 *  Use this everywhere a stored client_secret / token is compared against
 *  a user-supplied candidate so encryption is fully transparent. */
export async function timingSafeSecretEqual(
  env: Env,
  stored: string | null | undefined,
  candidate: string,
): Promise<boolean> {
  if (!stored || !candidate) return false;
  const plain = await decryptSecret(env, stored);
  if (plain == null) return false;
  return constantTimeStringEqual(plain, candidate);
}

// ─── base64url ───────────────────────────────────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array | null {
  try {
    const padded =
      s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
