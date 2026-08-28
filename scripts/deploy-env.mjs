// Build and deploy a non-production environment (staging / preview) with the
// Vite SSR pipeline intact.
//
// Usage: bun scripts/deploy-env.mjs <staging|preview>
//
// Two subtleties this handles that a single chained npm script cannot do
// reliably:
//
//  1. CLOUDFLARE_ENV selects the environment at *build* time — the Vite plugin
//     resolves exactly one environment per build. It must NOT be set at
//     *deploy* time: wrangler would then re-apply it on top of the already
//     resolved worker name (prism-staging -> prism-staging-staging). Chaining
//     `CLOUDFLARE_ENV=x bun run build && wrangler deploy` leaks the variable
//     into the deploy step, so we run build and deploy as separate child
//     processes with explicit, per-step environments instead.
//
//  2. The generated dist/prism/wrangler.json carries a `targetEnvironment`
//     field that wrangler also treats like `--env`, causing the same doubled
//     name. We strip it before deploying. (Absent from the production build.)

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const targetEnv = process.argv[2];
if (targetEnv !== "staging" && targetEnv !== "preview") {
  console.error("usage: bun scripts/deploy-env.mjs <staging|preview>");
  process.exit(1);
}

const CONFIG = "dist/prism/wrangler.json";

function run(args, env, label) {
  const res = spawnSync("bun", args, { stdio: "inherit", env });
  if (res.error) {
    console.error(`${label} failed to start:`, res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);
}

// 1. Build for the target environment (CLOUDFLARE_ENV set only here).
run(["run", "build"], { ...process.env, CLOUDFLARE_ENV: targetEnv }, "build");

// 2. Drop the field that would make wrangler re-apply the environment.
const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
if ("targetEnvironment" in cfg) {
  delete cfg.targetEnvironment;
  writeFileSync(CONFIG, JSON.stringify(cfg));
}
console.log(`Deploying ${cfg.name} (env: ${targetEnv})`);

// 3. Deploy with CLOUDFLARE_ENV explicitly absent so the name is not doubled.
const deployEnv = { ...process.env };
delete deployEnv.CLOUDFLARE_ENV;
run(["x", "wrangler", "deploy", "--config", CONFIG], deployEnv, "deploy");
