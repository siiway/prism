import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  checkLoginCredentialLimits,
  checkLoginRequestLimit,
  checkLoginTotpLimit,
  invalidLoginRateLimitConfig,
  type LoginRateLimitConfig,
} from "../worker/lib/loginRateLimit";
import { getConfig } from "../worker/lib/config";

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

  async first<T>() {
    return (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.db.query(this.sql).all(...this.values) as T[],
    };
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

const defaults: LoginRateLimitConfig = {
  ipv6_rate_limit_prefix: 64,
  login_dos_rate_limit: 120,
  login_dos_rate_window_seconds: 60,
  login_ip_rate_limit: 60,
  login_ip_rate_window_seconds: 60,
  login_identifier_rate_limit: 30,
  login_identifier_rate_window_seconds: 300,
  login_totp_rate_limit: 15,
  login_totp_rate_window_seconds: 300,
};

let sqlite: Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(migration);
  sqlite.exec(
    "CREATE TABLE site_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

async function submitLogin(config = defaults) {
  const request = await checkLoginRequestLimit(db, "192.0.2.1", config);
  if (!request.allowed) return false;
  const credential = await checkLoginCredentialLimits(
    db,
    "192.0.2.1",
    "user@example.com",
    config,
  );
  return credential.allowed;
}

describe("login rate limits", () => {
  test("loads the relaxed platform defaults", async () => {
    const config = await getConfig(db);

    expect(config.login_dos_rate_limit).toBe(120);
    expect(config.login_dos_rate_window_seconds).toBe(60);
    expect(config.login_ip_rate_limit).toBe(60);
    expect(config.login_ip_rate_window_seconds).toBe(60);
    expect(config.login_identifier_rate_limit).toBe(30);
    expect(config.login_identifier_rate_window_seconds).toBe(300);
    expect(config.login_totp_rate_limit).toBe(15);
    expect(config.login_totp_rate_window_seconds).toBe(300);
  });

  test("default allowance supports 15 complete password plus TOTP logins", async () => {
    for (let login = 0; login < 15; login++) {
      expect(await submitLogin()).toBe(true);
      expect(await submitLogin()).toBe(true);
    }

    expect(await submitLogin()).toBe(false);
  });

  test("uses configured allowances instead of fixed thresholds", async () => {
    const config = {
      ...defaults,
      login_ip_rate_limit: 100,
      login_identifier_rate_limit: 2,
    };

    expect(await submitLogin(config)).toBe(true);
    expect(await submitLogin(config)).toBe(true);
    expect(await submitLogin(config)).toBe(false);
  });

  test("applies the configured IP allowance across different identifiers", async () => {
    const config = { ...defaults, login_ip_rate_limit: 2 };

    for (const identifier of ["one@example.com", "two@example.com"]) {
      const result = await checkLoginCredentialLimits(
        db,
        "192.0.2.1",
        identifier,
        config,
      );
      expect(result.allowed).toBe(true);
    }
    const result = await checkLoginCredentialLimits(
      db,
      "192.0.2.1",
      "three@example.com",
      config,
    );
    expect(result).toEqual({ allowed: false, scope: "ip" });
  });

  test("applies the configured DoS allowance before credential checks", async () => {
    const config = { ...defaults, login_dos_rate_limit: 2 };

    expect(
      (await checkLoginRequestLimit(db, "192.0.2.1", config)).allowed,
    ).toBe(true);
    expect(
      (await checkLoginRequestLimit(db, "192.0.2.1", config)).allowed,
    ).toBe(true);
    expect(
      (await checkLoginRequestLimit(db, "192.0.2.1", config)).allowed,
    ).toBe(false);
  });

  test("shares the TOTP allowance across a user's login aliases", async () => {
    const config = { ...defaults, login_totp_rate_limit: 2 };

    expect((await checkLoginTotpLimit(db, "user-1", config)).allowed).toBe(
      true,
    );
    expect((await checkLoginTotpLimit(db, "user-1", config)).allowed).toBe(
      true,
    );
    expect((await checkLoginTotpLimit(db, "user-1", config)).allowed).toBe(
      false,
    );
    expect((await checkLoginTotpLimit(db, "user-2", config)).allowed).toBe(
      true,
    );
  });

  test("rejects unsafe platform setting values", () => {
    expect(invalidLoginRateLimitConfig({ login_ip_rate_limit: 0 })).toContain(
      "login_ip_rate_limit",
    );
    expect(
      invalidLoginRateLimitConfig({ login_totp_rate_window_seconds: 1.5 }),
    ).toContain("login_totp_rate_window_seconds");
    expect(
      invalidLoginRateLimitConfig({ login_dos_rate_limit: 120 }),
    ).toBeNull();
  });
});
