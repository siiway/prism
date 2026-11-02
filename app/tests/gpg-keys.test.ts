import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import * as openpgp from "openpgp";
import { addGpgKeys, verifySignedMessage } from "../src/worker/lib/gpg";
import { d1, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let db: D1Database;
const now = Math.floor(Date.now() / 1000);

interface TestKey {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

let alice: TestKey;
let bob: TestKey;
let carol: TestKey;

async function makeKey(name: string): Promise<TestKey> {
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: "curve25519",
    userIDs: [{ name, email: `${name.toLowerCase()}@example.com` }],
    format: "armored",
  });
  const key = await openpgp.readKey({ armoredKey: publicKey });
  return {
    publicKey,
    privateKey,
    fingerprint: key.getFingerprint().toLowerCase(),
  };
}

/** One armored block holding several keys, like `gpg --export --armor a b`. */
async function combinedBlock(...armored: string[]): Promise<string> {
  const parts = await Promise.all(
    armored.map(async (a) =>
      (await openpgp.readKey({ armoredKey: a })).write(),
    ),
  );
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return openpgp.armor(openpgp.enums.armor.publicKey, bytes);
}

function storedRows() {
  return sqlite
    .query(
      "SELECT fingerprint, name, public_key FROM user_gpg_keys WHERE user_id = 'u1' ORDER BY name",
    )
    .all() as { fingerprint: string; name: string; public_key: string }[];
}

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([
    makeKey("Alice"),
    makeKey("Bob"),
    makeKey("Carol"),
  ]);
});

beforeEach(() => {
  sqlite = migratedDatabase();
  db = d1(sqlite);
  sqlite
    .query(
      "INSERT INTO users (id, email, username, password_hash, created_at, updated_at) VALUES ('u1', 'u1@example.com', 'u1', '', ?, ?)",
    )
    .run(now, now);
});

describe("addGpgKeys", () => {
  test("splits concatenated armored blocks into one row per key", async () => {
    const result = await addGpgKeys(
      db,
      "u1",
      `${alice.publicKey}\n${bob.publicKey}`,
    );
    expect(result).toMatchObject({ ok: true, added: 2, skipped: 0 });

    const rows = storedRows();
    expect(rows.map((r) => r.fingerprint).sort()).toEqual(
      [alice.fingerprint, bob.fingerprint].sort(),
    );
    for (const row of rows) {
      const keys = await openpgp.readKeys({ armoredKeys: row.public_key });
      expect(keys).toHaveLength(1);
      expect(keys[0].getFingerprint().toLowerCase()).toBe(row.fingerprint);
    }
    expect(rows.map((r) => r.name)).toEqual([
      "Alice <alice@example.com>",
      "Bob <bob@example.com>",
    ]);
  });

  test("splits one armored block that holds several keys", async () => {
    const block = await combinedBlock(alice.publicKey, bob.publicKey);
    const result = await addGpgKeys(db, "u1", block, "Laptop");
    expect(result).toMatchObject({ ok: true, added: 2, skipped: 0 });
    expect(storedRows().map((r) => r.name)).toEqual(["Laptop #1", "Laptop #2"]);
  });

  test("keeps a given name as-is for a single key", async () => {
    await addGpgKeys(db, "u1", alice.publicKey, "  Laptop  ");
    expect(storedRows().map((r) => r.name)).toEqual(["Laptop"]);
  });

  test("skips keys repeated in the paste or already registered", async () => {
    await addGpgKeys(db, "u1", alice.publicKey);
    const result = await addGpgKeys(
      db,
      "u1",
      [alice.publicKey, bob.publicKey, bob.publicKey, carol.publicKey].join(
        "\n",
      ),
    );
    expect(result).toMatchObject({ ok: true, added: 2, skipped: 1 });
    expect(storedRows()).toHaveLength(3);
  });

  test("rejects a paste whose keys are all registered", async () => {
    await addGpgKeys(db, "u1", alice.publicKey);
    expect(await addGpgKeys(db, "u1", alice.publicKey)).toEqual({
      ok: false,
      error: "key_exists",
      status: 409,
    });
  });

  test("rejects text without a valid public key block", async () => {
    for (const text of [
      "not a key",
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\ngarbage\n-----END PGP PUBLIC KEY BLOCK-----",
    ]) {
      expect(await addGpgKeys(db, "u1", text)).toEqual({
        ok: false,
        error: "pgp_key_invalid",
        status: 400,
      });
    }
    expect(storedRows()).toHaveLength(0);
  });
});

describe("verifySignedMessage", () => {
  test("checks every key in a row that holds several", async () => {
    const message = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: "hello" }),
      signingKeys: await openpgp.readPrivateKey({
        armoredKey: bob.privateKey,
      }),
    });
    const result = await verifySignedMessage(message, [
      `${alice.publicKey}\n${bob.publicKey}`,
    ]);
    expect(result.valid).toBe(true);
    expect(result.signerKeyId).not.toBeNull();
  });
});
