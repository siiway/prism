// Cloudflare bindings for tests, backed by in-memory stand-ins: D1 over
// bun:sqlite, KV over a Map, and an ExecutionContext that swallows the
// background work handed to waitUntil.

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: Database,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const changes = () =>
      (this.db.query("SELECT total_changes() AS n").get() as { n: number }).n;
    const before = changes();
    // all() rather than run(), so a RETURNING clause hands back its rows.
    const results = this.db.query(this.sql).all(...this.values);
    return { success: true, results, meta: { changes: changes() - before } };
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

  /** Like D1, all statements succeed together or none do. */
  async batch(statements: SqliteD1Statement[]) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      this.db.exec("COMMIT");
      return results;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** A D1Database view of a bun:sqlite database. */
export function d1(db: Database): D1Database {
  return new SqliteD1(db) as unknown as D1Database;
}

const migrationsDir = join(import.meta.dir, "../../worker/db/migrations");

/** An in-memory database with every migration applied. */
export function migratedDatabase(): Database {
  const db = new Database(":memory:");
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  return db;
}

export class MemoryKv {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial))
      this.values.set(key, value);
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

export const executionCtx = {
  waitUntil(promise: Promise<unknown>) {
    void promise.catch(() => undefined);
  },
  passThroughOnException() {},
} as unknown as ExecutionContext;
