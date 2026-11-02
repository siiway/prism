// Build Prism for deployment.
//
//   bun run build [--skip-wasm]
//
// 1. Compiles the proof-of-work solver (src/pow) to public/pow.wasm, when Rust
//    is installed. Without it browsers use the slower JavaScript solver.
// 2. Typechecks the app and the Worker.
// 3. Builds the app and the Worker with Vite into dist/.
// 4. Writes wrangler.json at the repository root, so `wrangler deploy` ships
//    the Vite build instead of re-bundling src/worker from scratch.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  ROOT,
  bunx,
  has,
  info,
  ok,
  parseArgs,
  run,
  step,
  warn,
} from "./lib.ts";

const USAGE = `Usage: bun run build [options]

  --skip-wasm   Don't compile the proof-of-work solver
  -h, --help    Show this help`;

const { flags } = parseArgs(
  process.argv.slice(2),
  { flags: ["--skip-wasm"] },
  USAGE,
);

// rustup installs into ~/.cargo/bin, which a fresh shell may not have on PATH.
const cargoBin = join(
  process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
  "bin",
);
if (existsSync(cargoBin)) {
  process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH}`;
}

// ── Proof-of-work WASM ────────────────────────────────────────────────────────
if (flags.has("--skip-wasm")) {
  step("Skipping the proof-of-work WASM (--skip-wasm)");
} else if (!has("cargo")) {
  step("Skipping the proof-of-work WASM");
  warn(
    "Rust is not installed, so browsers will use the slower JavaScript solver.",
  );
  info("Install it from https://rustup.rs to build the WASM solver.");
} else {
  step("Building the proof-of-work WASM");
  const target = "wasm32-unknown-unknown";
  if (has("rustup")) {
    const installed = run("rustup", ["target", "list", "--installed"], {
      capture: true,
    });
    if (!installed.stdout.split(/\s+/).includes(target)) {
      run("rustup", ["target", "add", target]);
    }
  }
  run("cargo", [
    "build",
    "--release",
    "--target",
    target,
    "--manifest-path",
    join("src", "pow", "Cargo.toml"),
  ]);
  copyFileSync(
    join(ROOT, "src", "pow", "target", target, "release", "prism_pow.wasm"),
    join(ROOT, "public", "pow.wasm"),
  );
  ok("public/pow.wasm");
}

// ── Typecheck ─────────────────────────────────────────────────────────────────
step("Typechecking");
bunx("tsc", ["-p", "src/web"]);
bunx("tsc", ["-p", "src/worker"]);
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
