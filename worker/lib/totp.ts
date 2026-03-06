// TOTP implementation (RFC 6238 / RFC 4226) using Web Crypto

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let result = '';
  for (let i = 0; i < bytes.length; i += 5) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const b3 = bytes[i + 3] ?? 0;
    const b4 = bytes[i + 4] ?? 0;
    result += BASE32_CHARS[b0 >> 3];
    result += BASE32_CHARS[((b0 & 0x07) << 2) | (b1 >> 6)];
    result += BASE32_CHARS[(b1 >> 1) & 0x1f];
    result += BASE32_CHARS[((b1 & 0x01) << 4) | (b2 >> 4)];
    result += BASE32_CHARS[((b2 & 0x0f) << 1) | (b3 >> 7)];
    result += BASE32_CHARS[(b3 >> 2) & 0x1f];
    result += BASE32_CHARS[((b3 & 0x03) << 3) | (b4 >> 5)];
    result += BASE32_CHARS[b4 & 0x1f];
  }
  return result;
}

function base32ToBytes(secret: string): Uint8Array {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let bitsCount = 0;
  let byteIndex = 0;
  for (const ch of clean) {
    const val = BASE32_CHARS.indexOf(ch);
    if (val === -1) continue;
    bits = (bits << 5) | val;
    bitsCount += 5;
    if (bitsCount >= 8) {
      bytes[byteIndex++] = (bits >> (bitsCount - 8)) & 0xff;
      bitsCount -= 8;
    }
  }
  return bytes;
}

async function hotp(secret: Uint8Array, counter: bigint): Promise<number> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  // Write 64-bit big-endian counter
  view.setUint32(0, Number(counter >> 32n), false);
  view.setUint32(4, Number(counter & 0xffffffffn), false);

  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));
  const offset = hmac[19] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return code % 1_000_000;
}

export async function generateTotp(secret: string, timestampMs = Date.now()): Promise<string> {
  const counter = BigInt(Math.floor(timestampMs / 30_000));
  const secretBytes = base32ToBytes(secret);
  const code = await hotp(secretBytes, counter);
  return code.toString().padStart(6, '0');
}

export async function verifyTotp(
  token: string,
  secret: string,
  window = 1,
  timestampMs = Date.now(),
): Promise<boolean> {
  const secretBytes = base32ToBytes(secret);
  const counter = BigInt(Math.floor(timestampMs / 30_000));
  for (let i = -window; i <= window; i++) {
    const code = await hotp(secretBytes, counter + BigInt(i));
    if (code.toString().padStart(6, '0') === token) return true;
  }
  return false;
}

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    const code = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 8)
      .toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

export function totpUri(secret: string, email: string, issuer: string): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?${params}`;
}
