#!/usr/bin/env python3
"""Build script for Prism — works on Linux, macOS, and Windows."""

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IS_WIN = platform.system() == "Windows"
IS_MAC = platform.system() == "Darwin"


# ── Helpers ────────────────────────────────────────────────────────────────────

def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)

def info(msg: str) -> None:
    print(f"    {msg}", flush=True)

def ok(msg: str) -> None:
    print(f"    [ok] {msg}", flush=True)

def warn(msg: str) -> None:
    print(f"    [warn] {msg}", file=sys.stderr, flush=True)

def run(*args: str, cwd: Path = ROOT, check: bool = True) -> int:
    result = subprocess.run(args, cwd=cwd)
    if check and result.returncode != 0:
        sys.exit(result.returncode)
    return result.returncode

def has(cmd: str) -> bool:
    return shutil.which(cmd) is not None

def refresh_path() -> None:
    """Re-add common toolchain dirs to PATH for this process."""
    additions = [
        Path.home() / ".cargo" / "bin",        # Rust
        Path.home() / ".local" / "share" / "pnpm",  # pnpm (Linux)
        Path.home() / "AppData" / "Roaming" / "pnpm",  # pnpm (Windows)
        Path.home() / ".fnm",                  # fnm
        Path("/usr/local/bin"),
    ]
    current = os.environ.get("PATH", "")
    extra = os.pathsep.join(str(p) for p in additions if p.exists() and str(p) not in current)
    if extra:
        os.environ["PATH"] = extra + os.pathsep + current

def download(url: str, dest: Path) -> None:
    info(f"Downloading {url}")
    urllib.request.urlretrieve(url, dest)

def shell_run(cmd: str, **kwargs) -> int:
    result = subprocess.run(cmd, shell=True, **kwargs)
    return result.returncode


# ── Toolchain: Rust / cargo ───────────────────────────────────────────────────

def ensure_rust() -> None:
    refresh_path()
    if has("cargo"):
        ver = subprocess.check_output(["cargo", "--version"]).decode().split()[1]
        ok(f"cargo {ver}")
        return

    step("Installing Rust via rustup")

    if IS_WIN:
        tmp = Path(tempfile.gettempdir()) / "rustup-init.exe"
        download("https://win.rustup.rs/x86_64", tmp)
        run(str(tmp), "-y", "--no-modify-path")
        tmp.unlink(missing_ok=True)
    else:
        if not has("curl"):
            print("ERROR: curl is required to install Rust", file=sys.stderr)
            sys.exit(1)
        code = shell_run(
            "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs"
            " | sh -s -- -y --no-modify-path"
        )
        if code != 0:
            sys.exit(code)

    refresh_path()
    ver = subprocess.check_output(["cargo", "--version"]).decode().split()[1]
    ok(f"cargo {ver}")

    info("Adding wasm32-unknown-unknown target")
    run("rustup", "target", "add", "wasm32-unknown-unknown")


# ── Toolchain: wasm-pack ──────────────────────────────────────────────────────

def ensure_wasm_pack() -> None:
    refresh_path()
    if has("wasm-pack"):
        ver = subprocess.check_output(["wasm-pack", "--version"]).decode().split()[1]
        ok(f"wasm-pack {ver}")
        return

    step("Installing wasm-pack")

    if IS_WIN:
        # Try winget
        if has("winget"):
            code = run(
                "winget", "install", "--id", "RustWasm.WasmPack",
                "-e", "--accept-source-agreements", "--accept-package-agreements",
                check=False,
            )
            refresh_path()
            if code == 0 and has("wasm-pack"):
                ok(f"wasm-pack {subprocess.check_output(['wasm-pack','--version']).decode().split()[1]}")
                return
        info("winget unavailable or failed — falling back to cargo install wasm-pack")
        run("cargo", "install", "wasm-pack")
    elif has("curl"):
        code = shell_run(
            "curl --proto '=https' --tlsv1.2 -sSf"
            " https://rustwasm.github.io/wasm-pack/installer/init.sh | sh"
        )
        if code != 0:
            info("Official installer failed — falling back to cargo install wasm-pack")
            run("cargo", "install", "wasm-pack")
    else:
        info("curl not found — falling back to cargo install wasm-pack")
        run("cargo", "install", "wasm-pack")

    refresh_path()
    ver = subprocess.check_output(["wasm-pack", "--version"]).decode().split()[1]
    ok(f"wasm-pack {ver}")


# ── Toolchain: Node.js ────────────────────────────────────────────────────────

def ensure_node() -> None:
    refresh_path()
    if has("node"):
        ver = subprocess.check_output(["node", "--version"]).decode().strip()
        ok(f"node {ver}")
        return

    step("Installing Node.js LTS")

    if IS_WIN:
        if has("winget"):
            code = run(
                "winget", "install", "--id", "OpenJS.NodeJS.LTS",
                "-e", "--accept-source-agreements", "--accept-package-agreements",
                check=False,
            )
            refresh_path()
            if code == 0 and has("node"):
                ok(f"node {subprocess.check_output(['node','--version']).decode().strip()}")
                return

        # Fallback: download MSI via Node's release API
        import json as _json
        info("Fetching Node.js LTS version list...")
        with urllib.request.urlopen("https://nodejs.org/dist/index.json") as r:
            releases = _json.loads(r.read())
        lts = next(x for x in releases if x["lts"])
        ver = lts["version"]
        msi_url = f"https://nodejs.org/dist/{ver}/node-{ver}-x64.msi"
        tmp = Path(tempfile.gettempdir()) / "node-lts.msi"
        download(msi_url, tmp)
        info(f"Installing Node.js {ver}...")
        run("msiexec.exe", "/i", str(tmp), "/quiet", "/norestart")
        tmp.unlink(missing_ok=True)

    elif IS_MAC:
        if has("brew"):
            run("brew", "install", "node@lts")
        elif has("curl"):
            # Use fnm
            if not has("fnm"):
                shell_run("curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell")
                refresh_path()
            if has("fnm"):
                run("fnm", "install", "--lts")
                run("fnm", "use", "lts-latest")
            else:
                print("ERROR: install Node.js manually: https://nodejs.org", file=sys.stderr)
                sys.exit(1)
        else:
            print("ERROR: install Node.js manually: https://nodejs.org", file=sys.stderr)
            sys.exit(1)
    else:
        # Linux
        if not has("fnm"):
            if has("curl"):
                shell_run("curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell")
            elif has("wget"):
                shell_run("wget -qO- https://fnm.vercel.app/install | bash -s -- --skip-shell")
            else:
                print("ERROR: install Node.js manually: https://nodejs.org", file=sys.stderr)
                sys.exit(1)
        refresh_path()
        run("fnm", "install", "--lts")
        run("fnm", "use", "lts-latest")

    refresh_path()
    ver = subprocess.check_output(["node", "--version"]).decode().strip()
    ok(f"node {ver}")


# ── Toolchain: pnpm ───────────────────────────────────────────────────────────

def ensure_pnpm() -> None:
    refresh_path()
    if has("pnpm"):
        ver = subprocess.check_output(["pnpm", "--version"]).decode().strip()
        ok(f"pnpm {ver}")
        return

    step("Installing pnpm")

    if has("corepack"):
        run("corepack", "enable", "pnpm")
        run("corepack", "prepare", "pnpm@latest", "--activate")
    elif has("npm"):
        run("npm", "install", "-g", "pnpm")
    elif IS_WIN:
        code = shell_run(
            "powershell -ExecutionPolicy Bypass -Command "
            "\"Invoke-WebRequest 'https://get.pnpm.io/install.ps1' -UseBasicParsing | Invoke-Expression\""
        )
        if code != 0:
            sys.exit(code)
    elif has("curl"):
        code = shell_run("curl -fsSL https://get.pnpm.io/install.sh | sh -")
        if code != 0:
            sys.exit(code)
    elif has("wget"):
        code = shell_run("wget -qO- https://get.pnpm.io/install.sh | sh -")
        if code != 0:
            sys.exit(code)
    else:
        print("ERROR: cannot install pnpm — no npm, corepack, curl, or wget found", file=sys.stderr)
        sys.exit(1)

    refresh_path()
    ver = subprocess.check_output(["pnpm", "--version"]).decode().strip()
    ok(f"pnpm {ver}")


# ── Build steps ───────────────────────────────────────────────────────────────

def build_wasm() -> None:
    step("Checking Rust toolchain")
    ensure_rust()

    step("Checking wasm-pack")
    ensure_wasm_pack()

    step("Building PoW WASM (pow/src/lib.rs)")
    run(
        "wasm-pack", "build",
        "--target", "no-modules",
        "--out-dir", "../public/pow-wasm",
        cwd=ROOT / "pow",
    )

    src = ROOT / "public" / "pow-wasm" / "prism_pow_bg.wasm"
    dst = ROOT / "public" / "pow.wasm"
    if src.exists():
        shutil.copy2(src, dst)
        info("copied -> public/pow.wasm")
    else:
        warn(f"expected {src} — skipping copy")


def build_frontend() -> None:
    step("Checking Node.js")
    ensure_node()

    step("Checking pnpm")
    ensure_pnpm()

    step("Installing dependencies")
    run("pnpm", "install", "--frozen-lockfile")

    step("Type-checking (app)")
    run("pnpm", "exec", "tsc", "-p", "tsconfig.app.json", "--noEmit")

    step("Type-checking (worker)")
    run("pnpm", "exec", "tsc", "-p", "tsconfig.worker.json", "--noEmit")

    step("Building frontend")
    run("pnpm", "exec", "vite", "build")

    print("\nBuild complete. Output in dist/")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Build Prism")
    parser.add_argument("--skip-wasm",     action="store_true", help="Skip PoW WASM build")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip frontend build")
    args = parser.parse_args()

    if not args.skip_wasm:
        build_wasm()
    if not args.skip_frontend:
        build_frontend()


if __name__ == "__main__":
    main()
