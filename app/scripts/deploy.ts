// Deploy Prism: build, apply pending D1 migrations, then publish the Worker.
//
//   bun run deploy [options]
//
// The build runs first so a compile error stops the deploy before anything
// touches production. Migrations run before the publish because they only add
// to the schema: the running code ignores what it doesn't know about, and the
// new code needs it in place.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  cloudflareApi,
  confirm,
  dim,
  fail,
  info,
  isCI,
  ok,
  parseArgs,
  progress,
  readWranglerConfig,
  run,
  step,
  warn,
  wrangler,
} from "./lib.ts";

const USAGE = `Usage: bun run deploy [options]

  --skip-build         Deploy what is already in dist/
  --skip-migrations    Publish without applying pending migrations
  --migrations-only    Apply migrations and stop
  --dry-run            Print each command instead of running it
  -y, --yes            Don't ask for confirmation (implied in CI)
  --database <name>    D1 database (default: the one in wrangler.jsonc)
  -h, --help           Show this help`;

const { flags, options } = parseArgs(
  process.argv.slice(2),
  {
    flags: [
      "--skip-build",
      "--skip-migrations",
      "--migrations-only",
      "--dry-run",
      "--yes",
    ],
    options: ["--database"],
    aliases: { "-y": "--yes" },
  },
  USAGE,
);
const dryRun = flags.has("--dry-run");
const migrationsOnly = flags.has("--migrations-only");
const migrate = !flags.has("--skip-migrations");
let build = !flags.has("--skip-build") && !migrationsOnly;

if (migrationsOnly && !migrate) {
  fail("--migrations-only and --skip-migrations cancel each other out");
}

const config = readWranglerConfig();
// Some wrangler commands ignore account_id in the config and ask which account
// to use when the login has more than one.
if (config.account_id) process.env.CLOUDFLARE_ACCOUNT_ID ??= config.account_id;
const database =
  options.get("--database") ??
  config.d1_databases?.[0]?.database_name ??
  "prism-db";

// ── Preflight ─────────────────────────────────────────────────────────────────
step("Preflight");
info(`worker:   ${config.name}`);
info(`database: ${database}`);
try {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  if (git(["status", "--porcelain"])) {
    warn("the working tree has uncommitted changes; deploying them anyway");
  }
  info(
    `commit:   ${git(["rev-parse", "--short", "HEAD"])} on ${git(["rev-parse", "--abbrev-ref", "HEAD"])}`,
  );
} catch {
  // Not a git checkout, or git isn't installed.
}

// ── Build ─────────────────────────────────────────────────────────────────────
// In CI a separate build step has usually run already. Only skip when its
// output is actually there; locally dist/ is often stale, so always rebuild.
const built =
  existsSync(join(ROOT, "wrangler.json")) &&
  existsSync(join(ROOT, "dist", "prism", "index.js"));
if (build && isCI && built) {
  build = false;
  step("Skipping the build");
  info("a CI build step already produced dist/ and wrangler.json");
}
if (build) {
  step("Building");
  run(process.execPath, [join(ROOT, "scripts", "build.ts")], { dryRun });
} else if (!migrationsOnly && !built) {
  warn("no built wrangler.json, so wrangler will re-bundle the source");
  warn("instead of deploying the Vite build. Run without --skip-build.");
}

// ── Pending migrations ────────────────────────────────────────────────────────
// Applied straight through the D1 API, the way `wrangler d1 migrations apply
// --remote` does it: each file runs as one query together with its row in the
// migrations table. Doing it here lets us show progress instead of
// wrangler's tables.
let pending: string[] = [];
let applyMigrations = async () => {};
if (migrate) {
  step("Pending migrations");
  const db =
    config.d1_databases?.find(
      (d) => d.database_name === database || d.binding === database,
    ) ?? fail(`${database} is not a D1 database in wrangler.jsonc`);
  if (!db.database_id)
    fail(`${database} has no database_id; run bun run setup`);
  const api = cloudflareApi();
  const accountId = await resolveAccount(api);
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  const d1 = `/accounts/${accountId}/d1/database/${db.database_id}/query`;
  const query = async (sql: string) => {
    const { status, json } = await api.request("POST", d1, { sql });
    const results = (json?.result ?? []) as { success?: boolean }[];
    if (!json?.success || results.some((r) => r.success === false)) {
      throw new Error(api.why(status, json));
    }
    return results as { results: Record<string, unknown>[] }[];
  };

  const table = `"${(db.migrations_table ?? "d1_migrations").replace(/"/g, '""')}"`;
  const dir = join(ROOT, db.migrations_dir ?? "migrations");
  let applied: Set<unknown>;
  try {
    const [res] = await query(`SELECT name FROM ${table} ORDER BY id`);
    applied = new Set(res.results.map((row) => row.name));
  } catch (err) {
    // A new database has no migrations table yet.
    if (!/no such table/i.test((err as Error).message)) {
      fail(`could not read the applied migrations: ${(err as Error).message}`);
    }
    applied = new Set();
  }
  pending = readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && !applied.has(file))
    .sort();

  if (pending.length === 0) {
    ok("none; the database is up to date");
  } else {
    info(
      `${pending.length} to apply${applied.size ? "" : " to a new database"}:`,
    );
    for (const name of pending.slice(0, 8)) info(dim(name));
    if (pending.length > 8) info(dim(`and ${pending.length - 8} more`));
  }

  applyMigrations = async () => {
    await query(`CREATE TABLE IF NOT EXISTS ${table}(
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );`);
    const bar = progress(pending.length);
    for (const [i, name] of pending.entries()) {
      bar.update(i, name);
      // Checkouts on Windows may have CRLF; the files are LF in git.
      const sql = readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n");
      try {
        await query(
          `${sql}\nINSERT INTO ${table} (name)\nvalues ('${name.replace(/'/g, "''")}');`,
        );
      } catch (err) {
        bar.done();
        fail(
          `${name} failed: ${(err as Error).message}\n` +
            `The ${i} before it are applied. Fix it and deploy again.`,
        );
      }
    }
    bar.update(pending.length, "");
    bar.done();
    ok(`${pending.length} applied`);
  };
}

// A CI run was approved by the commit that triggered it. Anything else without
// a terminal (a pipe, a cron job) has to say --yes explicitly.
if (!flags.has("--yes") && !dryRun) {
  if (isCI) {
    info("CI detected, so not asking for confirmation");
  } else {
    if (!process.stdin.isTTY) {
      fail("no terminal to confirm on; pass --yes for non-interactive runs");
    }
    const target = migrationsOnly
      ? "migrations only"
      : pending.length > 0
        ? "migrations + deploy"
        : "deploy only";
    const yes = confirm(`Apply to PRODUCTION (${target})?`, false);
    if (!yes) fail("aborted");
  }
}

// ── Migrate and publish ───────────────────────────────────────────────────────
if (pending.length > 0) {
  step("Applying migrations");
  if (dryRun) info(`would apply ${pending.length} migrations`);
  else await applyMigrations();
}

const done = (msg: string) =>
  console.log(`\n${dryRun ? "Dry run: nothing was changed." : msg}`);

if (migrationsOnly) {
  done("Migrations applied. Skipped the deploy (--migrations-only).");
  process.exit(0);
}

step("Deploying");
wrangler(["deploy"], { dryRun });
done("Deploy complete.");

/**
 * The account to deploy to: CLOUDFLARE_ACCOUNT_ID, then account_id in
 * wrangler.jsonc, then the login's only account.
 */
async function resolveAccount(
  api: ReturnType<typeof cloudflareApi>,
): Promise<string> {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id;
  if (id) return id;
  const accounts = await api.call<{ id: string }[]>("GET", "/accounts");
  if (accounts.length === 1) return accounts[0].id;
  return fail(
    "this login can use several accounts; set account_id in wrangler.jsonc",
  );
}
