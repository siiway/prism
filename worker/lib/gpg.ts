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
 * Verify an ASCII-armored cleartext-signed message against one or more public keys.
 * Returns the signed text and whether at least one valid signature was found.
 */
export async function verifyClearsign(
  armoredMessage: string,
  armoredPublicKeys: string[],
): Promise<VerifyResult> {
  const message = await openpgp.readCleartextMessage({
    cleartextMessage: armoredMessage,
  });
  const publicKeys = await Promise.all(
    armoredPublicKeys.map((k) => openpgp.readKey({ armoredKey: k })),
  );
  const result = await openpgp.verify({
    message,
    verificationKeys: publicKeys,
  });
  const signedText = message.getText();

  for (const sig of result.signatures) {
    try {
      await sig.verified; // throws if invalid
      const keyId = sig.keyID.toHex().toLowerCase();
      return { valid: true, signerKeyId: keyId, signedText };
    } catch {
      // signature invalid — continue checking others
    }
  }
  return { valid: false, signerKeyId: null, signedText };
}
