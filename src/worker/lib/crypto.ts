// Crypto utilities using Web Crypto API (no Node.js required)

const encoder = new TextEncoder();

/** Lowercase hex of the given bytes. */
export function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function randomId(bytes = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomBase64url(bytes = 32): string {
  return bufToBase64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function bufToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Decode base64url (padding optional). Throws on malformed input. */
export function base64urlToBuf(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + "=".repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Like `base64urlToBuf`, but returns null instead of throwing. */
export function tryBase64urlToBuf(str: string): Uint8Array | null {
  try {
    return base64urlToBuf(str);
  } catch {
    return null;
  }
}

/** Parse a base64url-encoded JSON segment (a JWT header or payload), or null
 *  when it is not valid base64url or not valid JSON. */
export function decodeBase64urlJson<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBuf(segment))) as T;
  } catch {
    return null;
  }
}

// PBKDF2 password hashing
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2:${bytesToHex(salt)}:${await pbkdf2(password, salt)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = await pbkdf2(password, hexToBytes(saltHex));
  return timingSafeStrEqual(hash, hashHex);
}

/** Length-independent constant-time string comparison.
 *  Use whenever comparing a user-supplied secret-like value to a stored one
 *  (client_secret, opaque tokens, signatures, etc.) to avoid leaking length
 *  or content via timing. */
export function timingSafeStrEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/** SHA-256 of a UTF-8 string. */
export function sha256(str: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(str));
}

/** SHA-256 of a UTF-8 string, as lowercase hex. */
export async function sha256Hex(str: string): Promise<string> {
  return bytesToHex(await sha256(str));
}

/** HMAC-SHA256 of a UTF-8 message. A string key is UTF-8 encoded. */
export async function hmacSha256(
  key: string | BufferSource,
  message: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

/** HMAC-SHA256 of a UTF-8 message, as lowercase hex. */
export async function hmacSha256Hex(
  key: string | BufferSource,
  message: string,
): Promise<string> {
  return bytesToHex(await hmacSha256(key, message));
}

// PKCE code_challenge verification
export async function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method === "plain") return timingSafeStrEqual(verifier, challenge);
  if (method === "S256") {
    return timingSafeStrEqual(
      bufToBase64url(await sha256(verifier)),
      challenge,
    );
  }
  return false;
}
