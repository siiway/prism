import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { verifyClientAssertion } from "../worker/lib/clientAssertion";
import { verifyDpopProof } from "../worker/lib/dpop";
import { claimReplayValue } from "../worker/lib/securityState";
import { rateLimit } from "../worker/middleware/rateLimit";
import type { OAuthAppRow } from "../worker/types";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const results = this.db.query(this.sql).all(...this.values);
    const { changes } = this.db.query("SELECT changes() AS changes").get() as {
      changes: number;
    };
    return { success: true, results, meta: { changes } };
  }

  async first<T>(columnName?: string) {
    const row =
      (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
    if (row === null || columnName === undefined) return row;
    return Object(row)[columnName] ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.db.query(this.sql).all(...this.values) as T[],
    };
  }

  async raw<T>() {
    return this.db.query(this.sql).values(...this.values) as T[];
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

const migration = await Bun.file(
  "worker/db/migrations/0073_atomic_security_state.sql",
).text();
const encoder = new TextEncoder();
const endpoint = "https://prism.example/oauth/token";

let sqlite: Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(migration);
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

function testEnv(database: D1Database): Env {
  return { DB: database } as Env;
}

afterEach(() => sqlite.close());

function base64url(value: string | ArrayBuffer): string {
  const bytes =
    typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function p256Key() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, publicJwk };
}

async function es256Jwt(
  privateKey: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${base64url(signature)}`;
}

function oauthApp(jwks: string): OAuthAppRow {
  return {
    id: "app-1",
    owner_id: "owner-1",
    name: "Atomic test app",
    description: "",
    icon_url: null,
    website_url: null,
    client_id: "atomic-client",
    client_secret: "unused",
    redirect_uris: "[]",
    allowed_scopes: "[]",
    optional_scopes: "[]",
    is_public: 0,
    is_active: 1,
    is_verified: 0,
    is_official: 0,
    is_first_party: 0,
    team_id: null,
    oidc_fields: "[]",
    use_jwt_tokens: 0,
    allow_self_manage_exported_permissions: 0,
    access_whitelist_enabled: 0,
    post_logout_redirect_uris: "[]",
    registration_access_token: null,
    token_endpoint_auth_method: "private_key_jwt",
    jwks,
    jwks_uri: null,
    backchannel_logout_uri: null,
    created_at: 0,
    updated_at: 0,
  };
}

describe("atomic security state", () => {
  test("reclaims expired rows as new security state is inserted", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .query(
        `WITH RECURSIVE counter(value) AS (
           VALUES(1)
           UNION ALL
           SELECT value + 1 FROM counter WHERE value < 250
         )
         INSERT INTO rate_limit_hits (id, bucket_hash, created_at, expires_at)
         SELECT printf('rate-%03d', value), 'expired', ?, ? FROM counter`,
      )
      .run(now - 60, now - 1);
    sqlite
      .query(
        `WITH RECURSIVE counter(value) AS (
           VALUES(1)
           UNION ALL
           SELECT value + 1 FROM counter WHERE value < 250
         )
         INSERT INTO security_replay_claims
           (claim_hash, claim_type, created_at, expires_at)
         SELECT printf('claim-%03d', value), 'dpop', ?, ? FROM counter`,
      )
      .run(now - 60, now - 1);

    for (let index = 0; index < 3; index++) {
      await rateLimit(db, `cleanup-${index}`, 1, 60);
      await claimReplayValue(
        db,
        "dpop",
        "cleanup-principal",
        `cleanup-${index}`,
        now + 60,
        now,
      );
    }

    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM rate_limit_hits WHERE expires_at <= ?",
        )
        .get(now),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM security_replay_claims WHERE expires_at <= ?",
        )
        .get(now),
    ).toEqual({ count: 0 });
  });

  test("admits exactly the rate-limit allowance across concurrent instances", async () => {
    const limit = 7;
    const otherInstance = new SqliteD1(sqlite) as unknown as D1Database;
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        rateLimit(
          index % 2 === 0 ? db : otherInstance,
          "same-client",
          limit,
          60,
        ),
      ),
    );

    expect(results.filter(({ allowed }) => allowed)).toHaveLength(limit);
    expect(results.filter(({ allowed }) => !allowed)).toHaveLength(
      results.length - limit,
    );
  });

  test("claims an identical valid DPoP proof exactly once", async () => {
    const { pair, publicJwk } = await p256Key();
    const envs = [
      testEnv(db),
      testEnv(new SqliteD1(sqlite) as unknown as D1Database),
    ];
    const proof = await es256Jwt(
      pair.privateKey,
      { typ: "dpop+jwt", alg: "ES256", jwk: publicJwk },
      {
        htm: "POST",
        htu: endpoint,
        iat: Math.floor(Date.now() / 1000),
        jti: "one-dpop-proof",
      },
    );
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        verifyDpopProof(envs[index % envs.length], proof, {
          htm: "POST",
          htu: endpoint,
        }),
      ),
    );

    expect(results.filter((result) => "jkt" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toHaveLength(31);
  });

  test("claims an identical valid private_key_jwt assertion exactly once", async () => {
    const { pair, publicJwk } = await p256Key();
    const envs = [
      testEnv(db),
      testEnv(new SqliteD1(sqlite) as unknown as D1Database),
    ];
    const app = oauthApp(
      JSON.stringify({ keys: [{ ...publicJwk, kid: "signing-key" }] }),
    );
    const now = Math.floor(Date.now() / 1000);
    const assertion = await es256Jwt(
      pair.privateKey,
      { typ: "JWT", alg: "ES256", kid: "signing-key" },
      {
        iss: app.client_id,
        sub: app.client_id,
        aud: endpoint,
        iat: now,
        exp: now + 300,
        jti: "one-client-assertion",
      },
    );
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        verifyClientAssertion(envs[index % envs.length], app, assertion, [
          endpoint,
        ]),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => !result)).toHaveLength(31);
  });
});
