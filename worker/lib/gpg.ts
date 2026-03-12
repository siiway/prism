// GPG helpers using openpgp.js (WebCrypto-native, CF Workers compatible)

import * as openpgp from "openpgp";

export interface ParsedKey {
  fingerprint: string; // 40-char lowercase hex
  keyId: string; // last 16 chars (key ID)
  uids: string[]; // user IDs from key
}

export async function parseArmoredPublicKey(
  armored: string,
): Promise<ParsedKey> {
  const key = await openpgp.readKey({ armoredKey: armored });
  const fingerprint = key.getFingerprint().toLowerCase();
  const keyId = fingerprint.slice(-16);
  const uids = key.getUserIDs();
  return { fingerprint, keyId, uids };
}

export interface VerifyResult {
  valid: boolean;
  signerKeyId: string | null; // 16-char hex key ID of the signing key
  signedText: string;
}

/**
 * Verify an ASCII-armored signed message against one or more public keys.
 * Accepts both cleartext-signed (--clearsign) and inline-signed (--sign --armor) formats.
 */
export async function verifySignedMessage(
  armoredMessage: string,
  armoredPublicKeys: string[],
): Promise<VerifyResult> {
  const publicKeys = await Promise.all(
    armoredPublicKeys.map((k) => openpgp.readKey({ armoredKey: k })),
  );

  const isCleartext = armoredMessage
    .trimStart()
    .startsWith("-----BEGIN PGP SIGNED MESSAGE-----");

  type Sigs = Awaited<ReturnType<typeof openpgp.verify>>["signatures"];
  let signedText: string;
  let signatures: Sigs;

  if (isCleartext) {
    const message = await openpgp.readCleartextMessage({
      cleartextMessage: armoredMessage,
    });
    const result = await openpgp.verify({
      message,
      verificationKeys: publicKeys,
    });
    signedText = message.getText();
    signatures = result.signatures;
  } else {
    const message = await openpgp.readMessage({ armoredMessage });
    const result = await openpgp.verify({
      message,
      verificationKeys: publicKeys,
    });
    const data = await result.data;
    signedText =
      typeof data === "string"
        ? data
        : new TextDecoder().decode(data as Uint8Array);
    signatures = result.signatures;
  }

  for (const sig of signatures) {
    try {
      await sig.verified;
      const keyId = sig.keyID.toHex().toLowerCase();
      return { valid: true, signerKeyId: keyId, signedText };
    } catch {
      // signature invalid — continue checking others
    }
  }
  return { valid: false, signerKeyId: null, signedText };
}

/** @deprecated Use verifySignedMessage — supports both clearsign and --sign --armor */
export const verifyClearsign = verifySignedMessage;
