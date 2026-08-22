#!/usr/bin/env python3
"""Deploy Prism — works on Linux, macOS, and Windows.

Builds, applies pending D1 migrations, then publishes the Worker.

Order matters. The build runs first so a compile error stops the deploy before
anything touches production. Migrations run next, because Prism's migrations
are additive - the new column has to exist before the code that reads it goes
live, and the currently-deployed code ignores columns it does not know about.
"""

import argparse
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IS_WIN = platform.system() == "Windows"


# ── Helpers ────────────────────────────────────────────────────────────────────

def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)

def info(msg: str) -> None:
    print(f"    {msg}", flush=True)

def ok(msg: str) -> None:
    print(f"    [ok] {msg}", flush=True)

def warn(msg: str) -> None:
    print(f"    [warn] {msg}", file=sys.stderr, flush=True)

def has(cmd: str) -> bool:
    return shutil.which(cmd) is not None


class Runner:
    """Runs commands, or prints them under --dry-run."""

    def __init__(self, dry_run: bool, package_manager: str) -> None:
        self.dry_run = dry_run
        self.pm = package_manager
        self._wrangler: tuple | None = None

    def run(self, *args: str, check: bool = True) -> int:
        if self.dry_run:
            info("would run: " + " ".join(args))
            return 0
        # shell=True on Windows so bunx/pnpm .cmd shims resolve.
        result = subprocess.run(list(args), cwd=ROOT, shell=IS_WIN)
        if check and result.returncode != 0:
            sys.exit(result.returncode)
        return result.returncode

    def wrangler_cmd(self) -> tuple:
        """How to invoke wrangler. It ships as a dev dependency, so the runner
        depends on what the environment has: a CI deploy step does not
        necessarily inherit a PATH that an earlier build step extended, which
        is why this falls back rather than insisting on one package manager."""
        if self._wrangler is None:
            if has("wrangler"):
                self._wrangler = ("wrangler",)
            elif self.pm == "pnpm" and has("pnpm"):
                self._wrangler = ("pnpm", "exec", "wrangler")
            elif has("bunx"):
                self._wrangler = ("bunx", "wrangler")
            elif has("pnpm"):
                self._wrangler = ("pnpm", "exec", "wrangler")
            elif has("npx"):
                self._wrangler = ("npx", "wrangler")
            else:
                print("ERROR: no way to run wrangler - install bun, pnpm, or node",
                      file=sys.stderr)
                sys.exit(1)
        return self._wrangler

    def wrangler(self, *args: str, check: bool = True) -> int:
        return self.run(*self.wrangler_cmd(), *args, check=check)


def worker_name() -> str:
    try:
        text = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
    except OSError:
        return "(unknown)"
    match = re.search(r'"name"\s*:\s*"([^"]*)"', text)
    return match.group(1) if match else "(unknown)"


def git_summary() -> None:
    if not has("git"):
        return
    try:
        status = subprocess.run(
            ["git", "status", "--porcelain"], cwd=ROOT,
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        head = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT,
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, OSError):
        return
    if status:
        warn("working tree has uncommitted changes - deploying them anyway")
    info(f"commit:   {head} on {branch}")


def confirm(target: str) -> None:
    print()
    try:
        reply = input(f"Apply to PRODUCTION ({target})? [y/N] ")
    except EOFError:
        print(
            "ERROR: no terminal to confirm on - pass --yes for non-interactive runs",
            file=sys.stderr,
        )
        sys.exit(1)
    if reply.strip().lower() not in ("y", "yes"):
        print("Aborted.")
        sys.exit(1)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy Prism")
    parser.add_argument("--skip-build",      action="store_true",
                        help="Deploy what is already in dist/ (no rebuild)")
    parser.add_argument("--skip-migrations", action="store_true",
                        help="Publish without applying pending migrations")
    parser.add_argument("--migrations-only", action="store_true",
                        help="Apply migrations and stop, without deploying")
    parser.add_argument("--dry-run",         action="store_true",
                        help="Print each command instead of running it")
    parser.add_argument("-y", "--yes",       action="store_true",
                        help="Do not prompt for confirmation")
    parser.add_argument("--database",        default="prism-db", metavar="NAME",
                        help="D1 database (default: prism-db)")
    parser.add_argument("--package-manager", default="bun", metavar="PM",
                        help="bun (default) or pnpm")
    args = parser.parse_args()

    r = Runner(args.dry_run, args.package_manager)

    step("Preflight")
    ok("wrangler: " + " ".join(r.wrangler_cmd()))
    info(f"worker:   {worker_name()}")
    info(f"database: {args.database}")
    git_summary()

    if not args.skip_build and not args.migrations_only:
        step("Building")
        required = "pnpm" if args.package_manager == "pnpm" else "bun"
        if not has(required):
            print(f"ERROR: {required} not found - see scripts/build.py", file=sys.stderr)
            sys.exit(1)
        r.run(sys.executable, str(ROOT / "scripts" / "build.py"),
              "--package-manager", args.package_manager)
    else:
        step("Skipping build")
        if not args.migrations_only and not (ROOT / "wrangler.json").exists():
            warn("no root wrangler.json - wrangler will re-bundle from source instead of")
            warn("using the Vite build. Run without --skip-build for a normal deploy.")

    if not args.skip_migrations:
        step("Pending migrations")
        r.wrangler("d1", "migrations", "list", args.database, "--remote", check=False)

    if not args.yes and not args.dry_run:
        target = "migrations + deploy"
        if args.migrations_only:
            target = "migrations only"
        elif args.skip_migrations:
            target = "deploy only"
        confirm(target)

    if not args.skip_migrations:
        step("Applying migrations")
        r.wrangler("d1", "migrations", "apply", args.database, "--remote")
        ok("migrations applied")

    if args.migrations_only:
        print("\nMigrations applied. Skipped deploy (--migrations-only).")
        return

    step("Deploying")
    r.wrangler("deploy")

    print("\nDeploy complete.")


if __name__ == "__main__":
    main()
