// Installs the prek git hooks from prek.toml (pre-commit and pre-push).
// Runs from `prepare`, so `bun install` sets them up. Skipped in CI and outside
// a git checkout, and never fails the install.
//
// The config lives in app/, not at the repository root where prek looks, so
// the hooks are installed with its path. They still run from the root, over
// the whole repository.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { bunx, isCI, ROOT, warn } from "./lib.ts";

const config = join(ROOT, "prek.toml");

if (!isCI && existsSync(join(ROOT, "..", ".git"))) {
  if (!bunx("prek", ["install", "-f", "-c", config], { allowFail: true }).ok) {
    warn(
      "could not install the git hooks; run `bun scripts/hooks.ts` in app/ to retry",
    );
  }
}
