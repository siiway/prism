// Build Prism for deployment.
//
//   bun run build
//
// 1. Typechecks the app and the Worker.
// 2. Builds the app and the Worker with Vite into dist/.
// 3. Writes wrangler.json next to wrangler.jsonc, so `wrangler deploy` ships
//    the Vite build instead of re-bundling src/worker from scratch.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, bunx, ok, parseArgs, step, tsc, warn } from "./lib.ts";

const USAGE = `Usage: bun run build

  -h, --help    Show this help`;

parseArgs(process.argv.slice(2), { flags: [] }, USAGE);

// ── Typecheck ─────────────────────────────────────────────────────────────────
step("Typechecking");
tsc(["-p", "src/web"]);
tsc(["-p", "src/worker"]);
ok("app and worker");

// ── Vite ──────────────────────────────────────────────────────────────────────
step("Building the app and the Worker");
bunx("vite", ["build"]);

// ── Deploy config ─────────────────────────────────────────────────────────────
// Vite writes dist/prism/wrangler.json with paths relative to dist/prism/.
// Copy it to the root (wrangler prefers wrangler.json over wrangler.jsonc) and
// rewrite those paths relative to the root. Getting migrations_dir wrong only
// shows up at deploy time, as "No migrations present".
step("Writing wrangler.json");
const built = join(ROOT, "dist", "prism", "wrangler.json");
if (!existsSync(built)) {
  warn(
    "dist/prism/wrangler.json is missing; wrangler deploy would re-bundle the source.",
  );
  process.exit(1);
}
const config = JSON.parse(readFileSync(built, "utf8"));
config.main = "dist/prism/index.js";
if (config.assets) config.assets.directory = "./dist/client";
for (const db of config.d1_databases ?? []) {
  if (typeof db.migrations_dir === "string") {
    db.migrations_dir = db.migrations_dir.replace(/^(\.\.\/)+/, "");
  }
}
writeFileSync(join(ROOT, "wrangler.json"), JSON.stringify(config));
ok("wrangler.json");

console.log("\nBuild complete. Deploy with: bun run deploy");
