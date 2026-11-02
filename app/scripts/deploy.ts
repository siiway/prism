// Deploy Prism: build, apply pending D1 migrations, then publish the Worker.
//
//   bun run deploy [options]
//
// The build runs first so a compile error stops the deploy before anything
// touches production. Migrations run before the publish because they only add
// to the schema: the running code ignores what it doesn't know about, and the
// new code needs it in place.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  confirm,
  closePrompts,
  fail,
  info,
  isCI,
  ok,
  parseArgs,
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

// ── Confirm ───────────────────────────────────────────────────────────────────
if (migrate) {
  step("Pending migrations");
  wrangler(["d1", "migrations", "list", database, "--remote"], {
    allowFail: true,
  });
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
      : migrate
        ? "migrations + deploy"
        : "deploy only";
    const yes = await confirm(`Apply to PRODUCTION (${target})?`, false);
    closePrompts();
    if (!yes) fail("aborted");
  }
}

// ── Migrate and publish ───────────────────────────────────────────────────────
if (migrate) {
  step("Applying migrations");
  wrangler(["d1", "migrations", "apply", database, "--remote"], { dryRun });
  if (!dryRun) ok("migrations applied");
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
