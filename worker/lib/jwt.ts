// HS256 JWT implementation using Web Crypto API

function encodeBase64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  let str = '';
  for (const c of new TextEncoder().encode(json)) str += String.fromCharCode(c);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeBase64url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(pad));
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('JWT secret is not set');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export interface JWTPayload {
  sub: string;
  role: 'admin' | 'user';
  sessionId: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64url({ alg: 'HS256', typ: 'JWT' });
  const body = encodeBase64url({ ...payload, iat: now, exp: now + expiresInSeconds });
  const message = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${message}.${sigB64}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, bodyB64, sigB64] = parts;
  const message = `${headerB64}.${bodyB64}`;

  const key = await importKey(secret);
  const sigPadded = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  const sigBin = atob(sigPadded + '='.repeat((4 - (sigPadded.length % 4)) % 4));
  const sig = new Uint8Array(sigBin.length);
  for (let i = 0; i < sigBin.length; i++) sig[i] = sigBin.charCodeAt(i);

  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(message));
  if (!valid) throw new Error('Invalid JWT signature');

  const payload = JSON.parse(decodeBase64url(bodyB64)) as JWTPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired');

  return payload;
}
