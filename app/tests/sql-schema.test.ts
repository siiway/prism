// Every static SQL statement the worker prepares must compile against the
// schema the migrations produce. Catches queries that name a column or table
// that does not exist (or no longer exists) before they fail at runtime.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { migratedDatabase } from "./setup/d1";

const root = join(import.meta.dir, "..");

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
  for (const file of workerSources(join(root, "src", "worker"))) {
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
    const db = migratedDatabase();
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
