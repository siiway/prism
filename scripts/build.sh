#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Flags ──────────────────────────────────────────────────────────────────────
SKIP_WASM=false
SKIP_FRONTEND=false

for arg in "$@"; do
  case $arg in
    --skip-wasm)     SKIP_WASM=true ;;
    --skip-frontend) SKIP_FRONTEND=true ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────
step()  { echo; echo "==> $*"; }
info()  { echo "    $*"; }
ok()    { echo "    [ok] $*"; }
warn()  { echo "    [warn] $*" >&2; }

has() { command -v "$1" &>/dev/null; }

# Source Cargo env if present but not yet on PATH
source_cargo_env() {
  local env_file="${CARGO_HOME:-$HOME/.cargo}/env"
  if [ -f "$env_file" ]; then
    # shellcheck source=/dev/null
    source "$env_file"
  fi
}

# ── Toolchain: Rust / cargo ────────────────────────────────────────────────────
ensure_rust() {
  source_cargo_env
  if has cargo; then
    ok "cargo $(cargo --version 2>/dev/null | awk '{print $2}')"
    return
  fi

  step "Installing Rust via rustup"
  if has curl; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path
  elif has wget; then
    wget -qO- https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path
  else
    echo "ERROR: need curl or wget to install Rust" >&2
    exit 1
  fi

  source_cargo_env
  ok "cargo $(cargo --version | awk '{print $2}')"

  # Add wasm32 target while we have rustup handy
  info "Adding wasm32-unknown-unknown target"
  rustup target add wasm32-unknown-unknown
}

# ── Toolchain: Node.js ────────────────────────────────────────────────────────
ensure_node() {
  if has node; then
    ok "node $(node --version)"
    return
  fi

  step "Installing Node.js via fnm"
  if ! has fnm; then
    if has curl; then
      curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    else
      echo "ERROR: Node.js not found and fnm installer requires curl" >&2
      echo "       Install Node.js manually: https://nodejs.org" >&2
      exit 1
    fi
    # Add fnm to PATH for this session
    export PATH="${HOME}/.local/share/fnm:${PATH}"
    eval "$(fnm env --shell bash 2>/dev/null || true)"
  fi

  fnm install --lts
  fnm use lts-latest
  ok "node $(node --version)"
}

# ── Toolchain: pnpm ───────────────────────────────────────────────────────────
ensure_pnpm() {
  if has pnpm; then
    ok "pnpm $(pnpm --version)"
    return
  fi

  step "Installing pnpm"

  # Prefer corepack if available (ships with Node 16+)
  if has corepack; then
    corepack enable pnpm
    corepack prepare pnpm@latest --activate
  elif has npm; then
    npm install -g pnpm
  elif has curl; then
    curl -fsSL https://get.pnpm.io/install.sh | sh -
    # Source the updated profile
    export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
    export PATH="$PNPM_HOME:$PATH"
  else
    echo "ERROR: cannot install pnpm — no npm, corepack, or curl found" >&2
    exit 1
  fi

  ok "pnpm $(pnpm --version)"
}

# ── PoW WASM ───────────────────────────────────────────────────────────────────
if [ "$SKIP_WASM" = false ]; then
  step "Checking Rust toolchain"
  ensure_rust

  step "Building PoW WASM (pow/src/lib.rs)"
  cd "$ROOT/pow"
  cargo build --target wasm32-unknown-unknown --release
  cd "$ROOT"

  WASM_SRC="$ROOT/pow/target/wasm32-unknown-unknown/release/prism_pow.wasm"
  WASM_DST="$ROOT/public/pow.wasm"
  if [ -f "$WASM_SRC" ]; then
    cp "$WASM_SRC" "$WASM_DST"
    info "copied -> public/pow.wasm"
  else
    warn "expected $WASM_SRC — skipping copy"
  fi
fi

# ── Frontend ───────────────────────────────────────────────────────────────────
if [ "$SKIP_FRONTEND" = false ]; then
  step "Checking Node.js"
  ensure_node

  step "Checking pnpm"
  ensure_pnpm

  step "Installing dependencies"
  pnpm install --frozen-lockfile

  step "Type-checking (app)"
  pnpm exec tsc -p tsconfig.app.json --noEmit

  step "Type-checking (worker)"
  pnpm exec tsc -p tsconfig.worker.json --noEmit

  step "Building frontend"
  pnpm exec vite build

  echo
  echo "Build complete. Output in dist/"
fi
