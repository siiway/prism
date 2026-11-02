// Installs the prek git hooks from prek.toml (pre-commit and pre-push).
// Runs from `prepare`, so `bun install` sets them up. Skipped in CI and outside
// a git checkout, and never fails the install.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { bunx, isCI, ROOT, warn } from "./lib.ts";

if (!isCI && existsSync(join(ROOT, ".git"))) {
  if (!bunx("prek", ["install"], { allowFail: true }).ok) {
    warn("could not install the git hooks; run `bunx prek install` yourself");
  }
}
