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

/** Most keys one add accepts; keeps the insert batch well inside D1 limits. */
export const MAX_GPG_KEYS_PER_ADD = 20;

const NAME_MAX = 128;

export type AddGpgKeysResult =
  | { ok: true; keys: AddedGpgKey[]; added: number; skipped: number }
  | {
      ok: false;
      status: 400 | 409;
      body: { error: string; params?: Record<string, number> };
    };

const invalidKey = {
  ok: false,
  status: 400,
  body: { error: "pgp_key_invalid" },
} as const;
const keyExists = {
  ok: false,
  status: 409,
  body: { error: "key_exists" },
} as const;

/** Read a stored row's keys, or none if it no longer parses. */
async function readStoredKeys(armored: string): Promise<openpgp.Key[]> {
  try {
    return await readPublicKeys(armored);
  } catch {
    return [];
  }
}

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
    return invalidKey;
  }
  if (parsed.length === 0) {
    return invalidKey;
  }

  const seen = new Set<string>();
  const unique = parsed.filter((k) => {
    if (seen.has(k.fingerprint)) return false;
    seen.add(k.fingerprint);
    return true;
  });
  if (unique.length > MAX_GPG_KEYS_PER_ADD) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "gpg_too_many_keys",
        params: { max: MAX_GPG_KEYS_PER_ADD },
      },
    };
  }

  // A row saved whole by the old OAuth path can hold keys besides the one
  // its fingerprint column names, so count those as registered too.
  const { results: existingRows } = await db
    .prepare(
      "SELECT fingerprint, public_key FROM user_gpg_keys WHERE user_id = ?",
    )
    .bind(userId)
    .all<{ fingerprint: string; public_key: string }>();
  const existing = new Set(existingRows.map((r) => r.fingerprint));
  for (const row of existingRows) {
    for (const key of await readStoredKeys(row.public_key)) {
      existing.add(key.getFingerprint().toLowerCase());
    }
  }

  const toAdd = unique.filter((k) => !existing.has(k.fingerprint));
  if (toAdd.length === 0) {
    return keyExists;
  }

  const now = Math.floor(Date.now() / 1000);
  const baseName = name?.trim();
  const labelFor = (k: ParsedKeyWithArmor, i: number) => {
    if (!baseName) return (k.uids[0] || k.keyId).slice(0, NAME_MAX);
    if (toAdd.length === 1) return baseName.slice(0, NAME_MAX);
    const suffix = ` #${i + 1}`;
    return baseName.slice(0, NAME_MAX - suffix.length) + suffix;
  };
  const candidates: AddedGpgKey[] = toAdd.map((k, i) => ({
    id: randomId(16),
    fingerprint: k.fingerprint,
    key_id: k.keyId,
    name: labelFor(k, i),
    created_at: now,
    last_used_at: null,
  }));
  // A concurrent add may have registered some of these since the check
  // above; skip those instead of failing the whole batch.
  const results = await db.batch(
    candidates.map((k, i) =>
      db
        .prepare(
          "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, fingerprint) DO NOTHING",
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
  const keys = candidates.filter((_, i) => results[i].meta.changes > 0);
  if (keys.length === 0) {
    return keyExists;
  }

  return {
    ok: true,
    keys,
    added: keys.length,
    skipped: parsed.length - keys.length,
  };
}

export interface VerifyResult {
  valid: boolean;
  signerKeyId: string | null; // 16-char hex key ID of the signing (sub)key
  /** Index into the given public keys of the entry that holds the signer. */
  signerIndex: number | null;
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
  const keysPerEntry = await Promise.all(armoredPublicKeys.map(readStoredKeys));
  const publicKeys = keysPerEntry.flat();

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
      // The signer may be a subkey, so look it up among each entry's keys
      // rather than comparing against primary key IDs.
      const index = keysPerEntry.findIndex((keys) =>
        keys.some((k) => k.getKeys(sig.keyID).length > 0),
      );
      return {
        valid: true,
        signerKeyId: keyId,
        signerIndex: index === -1 ? null : index,
        signedText,
      };
    } catch {
      // signature invalid — continue checking others
    }
  }
  return { valid: false, signerKeyId: null, signerIndex: null, signedText };
}
