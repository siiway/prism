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

export interface ParsedKeyWithArmor extends ParsedKey {
  /** The individual key re-armored on its own, suitable for storage. */
  armored: string;
}

/**
 * Parse a paste that may contain several public keys: multiple armored
 * blocks concatenated, a single block holding multiple keys (e.g.
 * `gpg --export --armor key1 key2`), or both. Each key is re-armored
 * individually so callers can store/verify them independently.
 */
export async function parseArmoredPublicKeys(
  armored: string,
): Promise<ParsedKeyWithArmor[]> {
  const blocks = armored.match(
    /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]+?-----END PGP PUBLIC KEY BLOCK-----/g,
  );
  if (!blocks || blocks.length === 0) {
    throw new Error("No PGP public key block found");
  }
  const out: ParsedKeyWithArmor[] = [];
  for (const block of blocks) {
    const keys = await openpgp.readKeys({ armoredKeys: block });
    for (const key of keys) {
      const fingerprint = key.getFingerprint().toLowerCase();
      out.push({
        fingerprint,
        keyId: fingerprint.slice(-16),
        uids: key.getUserIDs(),
        armored: key.armor(),
      });
    }
  }
  return out;
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
