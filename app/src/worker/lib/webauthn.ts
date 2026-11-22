// WebAuthn helpers wrapping @simplewebauthn/server
// @simplewebauthn/server v10+ uses Web Crypto natively - compatible with CF Workers

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { PasskeyRow } from "../types";

export interface StoredPasskey {
  id: string;
  credentialId: string;
  publicKey: string; // base64url
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  name: string | null;
}

export function rowToPasskey(row: PasskeyRow): StoredPasskey {
  return {
    id: row.id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: row.counter,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    transports: JSON.parse(row.transports) as string[],
    name: row.name,
  };
}

export async function beginPasskeyRegistration(
  userId: string,
  email: string,
  displayName: string,
  existingPasskeys: StoredPasskey[],
  rpId: string,
  rpName: string,
) {
  return generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
    userName: email,
    userDisplayName: displayName,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports,
    })),
    // Signing in with a passkey requires user verification, so one that
    // can't do it would register and then never sign in.
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
}

export async function finishPasskeyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  rpId: string,
  origin: string,
) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedRPID: rpId,
    expectedOrigin: origin,
    requireUserVerification: true,
  });
}

/** `requireUserVerification` is for signing in with the passkey alone: the
 *  authenticator must then check a PIN or biometric, or a key with no PIN
 *  would let whoever holds it in with nothing else. Confirming an action in
 *  an existing session only asks for it when available. */
export async function beginPasskeyAuthentication(
  passkeys: StoredPasskey[],
  rpId: string,
  requireUserVerification: boolean,
) {
  return generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports,
    })),
    userVerification: requireUserVerification ? "required" : "preferred",
  });
}

export async function finishPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: StoredPasskey,
  rpId: string,
  origin: string,
  requireUserVerification: boolean,
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedRPID: rpId,
    expectedOrigin: origin,
    credential: {
      id: passkey.credentialId,
      publicKey: base64urlToUint8Array(
        passkey.publicKey,
      ) as Uint8Array<ArrayBuffer>,
      counter: passkey.counter,
      transports: passkey.transports,
    },
    requireUserVerification,
  });
}

function base64urlToUint8Array(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + "=".repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Whether a failed passkey check failed only for want of user
 *  verification, as a security key without a PIN does. */
export function failedUserVerification(err: unknown): boolean {
  return err instanceof Error && /user verification/i.test(err.message);
}
