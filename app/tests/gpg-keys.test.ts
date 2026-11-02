import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import * as openpgp from "openpgp";
import {
  addGpgKeys,
  MAX_GPG_KEYS_PER_ADD,
  verifySignedMessage,
} from "../src/worker/lib/gpg";
import { d1, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let db: D1Database;
const now = Math.floor(Date.now() / 1000);
const keyExists = {
  ok: false,
  status: 409,
  body: { error: "key_exists" },
} as const;

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

  test("keeps the #n suffix when a long name is cut", async () => {
    await addGpgKeys(
      db,
      "u1",
      `${alice.publicKey}\n${bob.publicKey}`,
      "x".repeat(200),
    );
    const names = storedRows().map((r) => r.name);
    expect(names.map((n) => n.length)).toEqual([128, 128]);
    expect(names.map((n) => n.slice(-3))).toEqual([" #1", " #2"]);
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
    expect(result).toMatchObject({ ok: true, added: 2, skipped: 2 });
    expect(storedRows()).toHaveLength(3);
  });

  test("treats keys inside an older combined row as registered", async () => {
    sqlite
      .query(
        "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES ('legacy', 'u1', ?, ?, 'old', ?, ?)",
      )
      .run(
        alice.fingerprint,
        alice.fingerprint.slice(-16),
        `${alice.publicKey}\n${bob.publicKey}`,
        now,
      );
    expect(await addGpgKeys(db, "u1", bob.publicKey)).toEqual(keyExists);
    const result = await addGpgKeys(
      db,
      "u1",
      `${bob.publicKey}\n${carol.publicKey}`,
    );
    expect(result).toMatchObject({ ok: true, added: 1, skipped: 1 });
  });

  test("skips keys a concurrent add registered after the check", async () => {
    await addGpgKeys(db, "u1", alice.publicKey);
    // A stale read: the existing-key lookup sees nothing yet.
    const stale = {
      prepare: (sql: string) =>
        db.prepare(sql.startsWith("SELECT fingerprint") ? `${sql} AND 0` : sql),
      batch: (stmts: D1PreparedStatement[]) => db.batch(stmts),
    } as unknown as D1Database;

    const result = await addGpgKeys(
      stale,
      "u1",
      `${alice.publicKey}\n${bob.publicKey}`,
    );
    expect(result).toMatchObject({ ok: true, added: 1, skipped: 1 });
    expect(result.ok && result.keys.map((k) => k.fingerprint)).toEqual([
      bob.fingerprint,
    ]);
    expect(await addGpgKeys(stale, "u1", alice.publicKey)).toEqual(keyExists);
  });

  test("rejects a paste whose keys are all registered", async () => {
    await addGpgKeys(db, "u1", alice.publicKey);
    expect(await addGpgKeys(db, "u1", alice.publicKey)).toEqual(keyExists);
  });

  test("rejects more than the per-add limit of distinct keys", async () => {
    const many = await Promise.all(
      Array.from({ length: MAX_GPG_KEYS_PER_ADD + 1 }, (_, i) =>
        makeKey(`K${i}`),
      ),
    );
    expect(
      await addGpgKeys(db, "u1", many.map((k) => k.publicKey).join("\n")),
    ).toEqual({
      ok: false,
      status: 400,
      body: {
        error: "gpg_too_many_keys",
        params: { max: MAX_GPG_KEYS_PER_ADD },
      },
    });
    expect(storedRows()).toHaveLength(0);
  });

  test("rejects text without a valid public key block", async () => {
    for (const text of [
      "not a key",
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\ngarbage\n-----END PGP PUBLIC KEY BLOCK-----",
    ]) {
      expect(await addGpgKeys(db, "u1", text)).toEqual({
        ok: false,
        status: 400,
        body: { error: "pgp_key_invalid" },
      });
    }
    expect(storedRows()).toHaveLength(0);
  });
});

async function clearsign(privateKey: string): Promise<string> {
  return openpgp.sign({
    message: await openpgp.createCleartextMessage({ text: "hello" }),
    signingKeys: await openpgp.readPrivateKey({ armoredKey: privateKey }),
  });
}

describe("verifySignedMessage", () => {
  test("finds the signer in a row that holds several keys", async () => {
    const result = await verifySignedMessage(await clearsign(bob.privateKey), [
      carol.publicKey,
      `${alice.publicKey}\n${bob.publicKey}`,
    ]);
    expect(result.valid).toBe(true);
    expect(result.signerIndex).toBe(1);
  });

  test("finds the row when a signing subkey made the signature", async () => {
    const { publicKey, privateKey } = await openpgp.generateKey({
      type: "curve25519",
      userIDs: [{ name: "Dana" }],
      subkeys: [{ sign: true }],
      format: "armored",
    });
    const key = await openpgp.readKey({ armoredKey: publicKey });
    const result = await verifySignedMessage(await clearsign(privateKey), [
      alice.publicKey,
      publicKey,
    ]);
    expect(result.valid).toBe(true);
    expect(result.signerKeyId).not.toBe(key.getKeyID().toHex());
    expect(result.signerIndex).toBe(1);
  });

  test("ignores a stored row that no longer parses", async () => {
    const result = await verifySignedMessage(
      await clearsign(alice.privateKey),
      ["garbage", alice.publicKey],
    );
    expect(result).toMatchObject({ valid: true, signerIndex: 1 });
  });
});
