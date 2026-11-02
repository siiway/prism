// GPG helpers using openpgp.js (WebCrypto-native, CF Workers compatible)

import * as openpgp from "openpgp";
import { randomId } from "./crypto";

export interface ParsedKeyWithArmor {
  fingerprint: string; // 40-char lowercase hex
  keyId: string; // last 16 chars (key ID)
  uids: string[]; // user IDs from key
  /** The individual key re-armored on its own, suitable for storage. */
  armored: string;
}

const ARMORED_KEY_BLOCK =
  /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]+?-----END PGP PUBLIC KEY BLOCK-----/g;

/**
 * Read every public key in some text: several armored blocks concatenated,
 * one block holding several keys (e.g. `gpg --export --armor key1 key2`),
 * or both. Throws when there is no armored block or a block won't parse.
 */
async function readPublicKeys(text: string): Promise<openpgp.Key[]> {
  const blocks = text.match(ARMORED_KEY_BLOCK);
  if (!blocks || blocks.length === 0) {
    throw new Error("No PGP public key block found");
  }
  const keys: openpgp.Key[] = [];
  for (const block of blocks) {
    keys.push(...(await openpgp.readKeys({ armoredKeys: block })));
  }
  return keys;
}

/**
 * Split a paste into its public keys, each re-armored on its own so callers
 * can store and verify them independently.
 */
export async function parseArmoredPublicKeys(
  armored: string,
): Promise<ParsedKeyWithArmor[]> {
  const keys = await readPublicKeys(armored);
  return keys.map((key) => {
    const fingerprint = key.getFingerprint().toLowerCase();
    return {
      fingerprint,
      keyId: fingerprint.slice(-16),
      uids: key.getUserIDs(),
      armored: key.armor(),
    };
  });
}

export interface AddedGpgKey {
  id: string;
  fingerprint: string;
  key_id: string;
  name: string;
  created_at: number;
  last_used_at: null;
}

export type AddGpgKeysResult =
  | { ok: true; keys: AddedGpgKey[]; added: number; skipped: number }
  | { ok: false; error: "pgp_key_invalid"; status: 400 }
  | { ok: false; error: "key_exists"; status: 409 };

/**
 * Add every key in a paste as its own row. Keys repeated in the paste or
 * already registered are skipped and counted. A name applies as-is to a
 * single key; with several, each gets a #n suffix so rows stay apart.
 */
export async function addGpgKeys(
  db: D1Database,
  userId: string,
  publicKey: string,
  name?: string,
): Promise<AddGpgKeysResult> {
  let parsed: ParsedKeyWithArmor[];
  try {
    parsed = await parseArmoredPublicKeys(publicKey);
  } catch {
    return { ok: false, error: "pgp_key_invalid", status: 400 };
  }
  if (parsed.length === 0) {
    return { ok: false, error: "pgp_key_invalid", status: 400 };
  }

  const seen = new Set<string>();
  const unique = parsed.filter((k) => {
    if (seen.has(k.fingerprint)) return false;
    seen.add(k.fingerprint);
    return true;
  });

  const { results: existingRows } = await db
    .prepare("SELECT fingerprint FROM user_gpg_keys WHERE user_id = ?")
    .bind(userId)
    .all<{ fingerprint: string }>();
  const existing = new Set(existingRows.map((r) => r.fingerprint));

  const toAdd = unique.filter((k) => !existing.has(k.fingerprint));
  if (toAdd.length === 0) {
    return { ok: false, error: "key_exists", status: 409 };
  }

  const now = Math.floor(Date.now() / 1000);
  const baseName = name?.trim();
  const keys: AddedGpgKey[] = toAdd.map((k, i) => ({
    id: randomId(16),
    fingerprint: k.fingerprint,
    key_id: k.keyId,
    name: (baseName
      ? toAdd.length === 1
        ? baseName
        : `${baseName} #${i + 1}`
      : k.uids[0] || k.keyId
    ).slice(0, 128),
    created_at: now,
    last_used_at: null,
  }));
  await db.batch(
    keys.map((k, i) =>
      db
        .prepare(
          "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          k.id,
          userId,
          k.fingerprint,
          k.key_id,
          k.name,
          toAdd[i].armored,
          now,
        ),
    ),
  );

  return {
    ok: true,
    keys,
    added: keys.length,
    skipped: unique.length - toAdd.length,
  };
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
  // A stored row may hold several keys: OAuth adds used to keep the paste
  // whole, so read every key in it rather than just the first.
  const publicKeys = (
    await Promise.all(armoredPublicKeys.map(readPublicKeys))
  ).flat();

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
