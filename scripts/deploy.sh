#!/usr/bin/env bash
# Deploy Prism: build, apply pending D1 migrations, then publish the Worker.
#
# Order matters. The build runs first so a compile error stops the deploy
# before anything touches production. Migrations run next, because Prism's
# migrations are additive — the new column has to exist before the code that
# reads it goes live, and the currently-deployed code ignores columns it does
# not know about.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Flags ──────────────────────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_MIGRATIONS=false
MIGRATIONS_ONLY=false
DRY_RUN=false
ASSUME_YES=false
PM="bun"
DATABASE="prism-db"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy.sh [options]

  --skip-build            Deploy what is already in dist/ (no rebuild)
  --skip-migrations       Publish without applying pending migrations
  --migrations-only       Apply migrations and stop, without deploying
  --dry-run               Print each command instead of running it
  -y, --yes               Do not prompt for confirmation
  --database <name>       D1 database (default: prism-db)
  --package-manager <pm>  bun (default) or pnpm
  -h, --help              Show this help
USAGE
}

args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
  arg="${args[$i]}"
  case $arg in
    --skip-build)        SKIP_BUILD=true ;;
    --skip-migrations)   SKIP_MIGRATIONS=true ;;
    --migrations-only)   MIGRATIONS_ONLY=true ;;
    --dry-run)           DRY_RUN=true ;;
    -y|--yes)            ASSUME_YES=true ;;
    --database=*)        DATABASE="${arg#--database=}" ;;
    --database)          i=$((i + 1)); DATABASE="${args[$i]}" ;;
    --package-manager=*) PM="${arg#--package-manager=}" ;;
    --package-manager)   i=$((i + 1)); PM="${args[$i]}" ;;
    -h|--help)           usage; exit 0 ;;
    *) echo "ERROR: unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
  i=$((i + 1))
done

# ── Helpers ────────────────────────────────────────────────────────────────────
step()  { echo; echo "==> $*"; }
info()  { echo "    $*"; }
ok()    { echo "    [ok] $*"; }
warn()  { echo "    [warn] $*" >&2; }

has() { command -v "$1" &>/dev/null; }

# Run a command, or just show it under --dry-run.
run() {
  if [ "$DRY_RUN" = true ]; then
    info "would run: $*"
    return 0
  fi
  "$@"
}

# How to invoke wrangler. It ships as a dev dependency, so the runner depends on
# what the environment has: a CI deploy step does not necessarily inherit a PATH
# that an earlier build step extended, which is why this falls back rather than
# insisting on one package manager.
WRANGLER_CMD=()
resolve_wrangler() {
  [ ${#WRANGLER_CMD[@]} -gt 0 ] && return 0
  if has wrangler; then
    WRANGLER_CMD=(wrangler)
  elif [ "$PM" = "pnpm" ] && has pnpm; then
    WRANGLER_CMD=(pnpm exec wrangler)
  elif has bunx; then
    WRANGLER_CMD=(bunx wrangler)
  elif has pnpm; then
    WRANGLER_CMD=(pnpm exec wrangler)
  elif has npx; then
    WRANGLER_CMD=(npx wrangler)
  else
    echo "ERROR: no way to run wrangler - install bun, pnpm, or node" >&2
    exit 1
  fi
}

# Named wr(), not wrangler(), so `run wrangler ...` reaches the real binary
# rather than recursing back into this function.
wr() {
  resolve_wrangler
  run "${WRANGLER_CMD[@]}" "$@"
}

# ── Preflight ──────────────────────────────────────────────────────────────────
step "Preflight"
resolve_wrangler
ok "wrangler: ${WRANGLER_CMD[*]}"
info "worker:   $(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' wrangler.jsonc | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
info "database: $DATABASE"

if has git && git rev-parse --is-inside-work-tree &>/dev/null; then
  if [ -n "$(git status --porcelain)" ]; then
    warn "working tree has uncommitted changes - deploying them anyway"
  fi
  info "commit:   $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
fi

# ── Build ──────────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ] && [ "$MIGRATIONS_ONLY" = false ]; then
  step "Building"
  if [ "$PM" = "pnpm" ]; then
    has pnpm || { echo "ERROR: pnpm not found - see scripts/build.sh" >&2; exit 1; }
  else
    has bun || { echo "ERROR: bun not found - see scripts/build.sh" >&2; exit 1; }
  fi
  run bash "$ROOT/scripts/build.sh" --package-manager "$PM"
else
  step "Skipping build"
  if [ "$MIGRATIONS_ONLY" = false ] && [ ! -f "$ROOT/wrangler.json" ]; then
    warn "no root wrangler.json - wrangler will re-bundle from source instead of"
    warn "using the Vite build. Run without --skip-build for a normal deploy."
  fi
fi

# ── Migrations ─────────────────────────────────────────────────────────────────
if [ "$SKIP_MIGRATIONS" = false ]; then
  step "Pending migrations"
  wr d1 migrations list "$DATABASE" --remote || true
fi

# ── Confirm ────────────────────────────────────────────────────────────────────
# A CI runner has no terminal to prompt on, and the commit that triggered the
# build is already the approval — so a recognised runner implies --yes.
#
# This keys on CI environment variables rather than "stdin is not a tty" on
# purpose. Someone piping input into this script, or running it from a cron or
# an editor task, has not consented to a production deploy; they should still
# hit the hard error below rather than silently ship.
if [ "$ASSUME_YES" = false ] && [ "$DRY_RUN" = false ] &&
  [ -n "${WORKERS_CI:-}${CI:-}${GITHUB_ACTIONS:-}${GITLAB_CI:-}" ]; then
  ASSUME_YES=true
  step "Confirm"
  info "CI detected - proceeding without an interactive confirmation"
fi

if [ "$ASSUME_YES" = false ] && [ "$DRY_RUN" = false ]; then
  target="migrations + deploy"
  [ "$MIGRATIONS_ONLY" = true ] && target="migrations only"
  [ "$SKIP_MIGRATIONS" = true ] && target="deploy only"
  echo
  read -r -p "Apply to PRODUCTION ($target)? [y/N] " reply </dev/tty || {
    echo "ERROR: no terminal to confirm on - pass --yes for non-interactive runs" >&2
    exit 1
  }
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

if [ "$SKIP_MIGRATIONS" = false ]; then
  step "Applying migrations"
  wr d1 migrations apply "$DATABASE" --remote
  ok "migrations applied"
fi

# ── Deploy ─────────────────────────────────────────────────────────────────────
if [ "$MIGRATIONS_ONLY" = true ]; then
  echo
  echo "Migrations applied. Skipped deploy (--migrations-only)."
  exit 0
fi

step "Deploying"
wr deploy

echo
echo "Deploy complete."
