// Crypto utilities using Web Crypto API (no Node.js required)

export function randomId(bytes = 16): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomBase64url(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return bufToBase64url(arr);
}

export function bufToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64urlToBuf(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// PBKDF2 password hashing
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const hash = new Uint8Array(bits);
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const hash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time comparison
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++)
    diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

// SHA-256 of a string, returns hex
export async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// PKCE code_challenge verification
export async function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method === "plain") {
    return verifier === challenge;
  }
  if (method === "S256") {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const computed = bufToBase64url(buf);
    return computed === challenge;
  }
  return false;
}

// Proof-of-Work verification: SHA-256(challenge + nonce) must have `difficulty` leading zero bits
export async function verifyPoW(
  challenge: string,
  nonce: number,
  difficulty: number,
): Promise<boolean> {
  const buf = new ArrayBuffer(challenge.length + 4);
  const view = new DataView(buf);
  const enc = new TextEncoder().encode(challenge);
  for (let i = 0; i < enc.length; i++) new DataView(buf).setUint8(i, enc[i]);
  view.setUint32(enc.length, nonce, false);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));

  let remaining = difficulty;
  for (const byte of hash) {
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
    } else {
      const mask = 0xff << (8 - remaining);
      return (byte & mask) === 0;
    }
  }
  return true;
}
