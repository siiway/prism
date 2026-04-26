// Envelope encryption for sensitive fields stored in D1.
//
// Most "secrets" in this codebase — OAuth app client_secret, OAuth source
// (external IdP) client_secret, captcha secret keys, SMTP/IMAP passwords,
// the GitHub README site PAT, etc. — used to live in plaintext. This
// module wraps them with AES-GCM using a master key sourced from a
// Cloudflare Secrets Store binding (`env.SECRETS_KEY`).
//
// Design choices:
//   - Single binding. Per-secret bindings don't scale to dynamic rows
//     (admins create OAuth sources / users create OAuth apps at runtime).
//     A site-wide master key + envelope encryption is the standard
//     pattern for this.
//   - Optional binding. If `env.SECRETS_KEY` is absent, encryptSecret is
//     a no-op (returns plaintext) and decryptSecret short-circuits any
//     value lacking the prefix. This keeps the legacy plaintext path
//     working until an admin runs the migrate flow.
//   - Self-describing format: ciphertext rows start with `__ENC_v1__` so
//     we can tell at-a-glance whether a row is encrypted. Real OAuth
//     client secrets are random alphanumeric, never start with this.
//   - Idempotent: encryptSecret on already-encrypted input returns it
//     unchanged so the migration job can be re-run safely.

const ENC_PREFIX = "__ENC_v1__";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/** Site-config keys whose values must be encrypted at rest. Anything
 *  missing from this list is stored as-is. Keep this list aligned with
 *  the admin migrate endpoint — it iterates the same set. */
export const SENSITIVE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "captcha_secret_key",
  "github_client_secret",
  "google_client_secret",
  "microsoft_client_secret",
  "discord_client_secret",
  "email_api_key",
  "imap_password",
  "smtp_password",
  "github_readme_token",
]);

let cachedKey: Promise<CryptoKey> | null = null;

/** Reset cached key — used by tests and the admin "I rotated the master
 *  key" flow. Not exported elsewhere because the binding is read-only. */
export function resetSecretsKeyCache(): void {
  cachedKey = null;
}

async function getMasterKey(env: Env): Promise<CryptoKey> {
  if (!env.SECRETS_KEY) {
    throw new Error("SECRETS_KEY binding is not configured");
  }
  if (!cachedKey) {
    cachedKey = (async () => {
      const raw = await env.SECRETS_KEY!.get();
      if (!raw) throw new Error("SECRETS_KEY value is empty");
      const bytes = base64UrlToBytes(raw.trim());
      if (!bytes || bytes.length !== KEY_LENGTH) {
        throw new Error(
          `SECRETS_KEY must be ${KEY_LENGTH} bytes encoded as base64url`,
        );
      }
      return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })();
  }
  return cachedKey;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
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

  const key = await getMasterKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
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

  const key = await getMasterKey(env);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct),
  );
  return new TextDecoder().decode(pt);
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
  // Same constant-time impl as lib/crypto's timingSafeStrEqual; inlined
  // here to avoid a circular import.
  if (plain.length !== candidate.length) {
    // Still walk both lengths so we don't leak length via timing.
    let acc = 1;
    const max = Math.max(plain.length, candidate.length);
    for (let i = 0; i < max; i++) {
      acc |= (plain.charCodeAt(i) || 0) ^ (candidate.charCodeAt(i) || 0);
    }
    return acc === 0;
  }
  let acc = 0;
  for (let i = 0; i < plain.length; i++) {
    acc |= plain.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return acc === 0;
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
