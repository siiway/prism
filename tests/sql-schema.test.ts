// Every static SQL statement the worker prepares must compile against the
// schema the migrations produce. Catches queries that name a column or table
// that does not exist (or no longer exists) before they fail at runtime.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const root = join(import.meta.dir, "..");
const migrationsDir = join(root, "worker/db/migrations");

function migratedSchema(): Database {
  const db = new Database(":memory:");
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

function workerSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "db" ? [] : workerSources(path);
    return e.name.endsWith(".ts") ? [path] : [];
  });
}

/** `.prepare("…")` / `.prepare(\`…\`)` literals without interpolation. */
function staticStatements(): Array<{ where: string; sql: string }> {
  const re =
    /\.prepare\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)\s*,?\s*\)/g;
  const out: Array<{ where: string; sql: string }> = [];
  for (const file of workerSources(join(root, "worker"))) {
    const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const m of src.matchAll(re)) {
      const raw = m[1] ?? m[2];
      if (m[2] !== undefined && raw.includes("${")) continue;
      const line = src.slice(0, m.index).split("\n").length;
      out.push({
        where: `${relative(root, file).split("\\").join("/")}:${line}`,
        sql: raw.replace(/\\(.)/g, "$1"),
      });
    }
  }
  return out;
}

describe("worker SQL", () => {
  test("every static statement compiles against the migrated schema", () => {
    const db = migratedSchema();
    const statements = staticStatements();
    expect(statements.length).toBeGreaterThan(500);
    const failures: string[] = [];
    for (const { where, sql } of statements) {
      try {
        db.prepare(sql);
      } catch (e) {
        failures.push(`${where}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
