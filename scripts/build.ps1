#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipWasm,
    [switch]$SkipFrontend
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

# ── Helpers ────────────────────────────────────────────────────────────────────
function Step([string]$msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Info([string]$msg)  { Write-Host "    $msg" }
function Ok([string]$msg)    { Write-Host "    [ok] $msg" -ForegroundColor Green }
function Warn([string]$msg)  { Write-Warning "    $msg" }

function Has([string]$cmd) {
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Invoke-Step([string[]]$cmd) {
    & $cmd[0] $cmd[1..($cmd.Length - 1)]
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Reload PATH from registry so newly installed tools are visible
function Refresh-Path {
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') ?? ''
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')    ?? ''
    $env:Path = ($machine + ';' + $user) -replace ';;+', ';'
}

# ── Toolchain: Rust / cargo ────────────────────────────────────────────────────
function Ensure-Rust {
    Refresh-Path
    if (Has 'cargo') {
        $ver = (cargo --version 2>$null) -replace 'cargo ',''
        Ok "cargo $ver"
        return
    }

    Step 'Installing Rust via rustup'

    $rustupExe = "$env:TEMP\rustup-init.exe"
    Info 'Downloading rustup-init.exe...'
    Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $rustupExe -UseBasicParsing
    & $rustupExe -y --no-modify-path
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Remove-Item $rustupExe -Force

    # Add Cargo bin to current session PATH
    $cargoBin = "$env:USERPROFILE\.cargo\bin"
    if ($env:Path -notlike "*$cargoBin*") {
        $env:Path = "$cargoBin;$env:Path"
    }

    Ok "cargo $(cargo --version -replace 'cargo ','')"

    Info 'Adding wasm32-unknown-unknown target'
    rustup target add wasm32-unknown-unknown
}

# ── Toolchain: wasm-pack ───────────────────────────────────────────────────────
function Ensure-WasmPack {
    Refresh-Path
    if (Has 'wasm-pack') {
        $ver = (wasm-pack --version 2>$null) -replace 'wasm-pack ',''
        Ok "wasm-pack $ver"
        return
    }

    Step 'Installing wasm-pack'

    # Try winget first (fast, pre-built binary)
    if (Has 'winget') {
        winget install --id RustWasm.WasmPack -e --accept-source-agreements --accept-package-agreements 2>$null
        Refresh-Path
        if (Has 'wasm-pack') {
            Ok "wasm-pack $(wasm-pack --version -replace 'wasm-pack ','')"
            return
        }
    }

    # Fallback: cargo install (slower, compiles from source)
    Info 'winget unavailable — falling back to cargo install wasm-pack (this may take a few minutes)'
    cargo install wasm-pack
    Refresh-Path
    Ok "wasm-pack $(wasm-pack --version -replace 'wasm-pack ','')"
}

# ── Toolchain: Node.js ────────────────────────────────────────────────────────
function Ensure-Node {
    Refresh-Path
    if (Has 'node') {
        Ok "node $(node --version)"
        return
    }

    Step 'Installing Node.js LTS'

    # Try winget
    if (Has 'winget') {
        winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
        Refresh-Path
        if (Has 'node') {
            Ok "node $(node --version)"
            return
        }
    }

    # Fallback: download MSI installer
    Info 'winget unavailable — downloading Node.js LTS MSI'
    $nodeJson = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $lts = $nodeJson | Where-Object { $_.lts } | Select-Object -First 1
    $msiUrl = "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-x64.msi"
    $msiPath = "$env:TEMP\node-lts.msi"
    Invoke-WebRequest $msiUrl -OutFile $msiPath -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
    Remove-Item $msiPath -Force
    Refresh-Path
    Ok "node $(node --version)"
}

# ── Toolchain: pnpm ───────────────────────────────────────────────────────────
function Ensure-Pnpm {
    Refresh-Path
    if (Has 'pnpm') {
        Ok "pnpm $(pnpm --version)"
        return
    }

    Step 'Installing pnpm'

    # Prefer corepack (ships with Node 16+)
    if (Has 'corepack') {
        corepack enable pnpm
        corepack prepare pnpm@latest --activate
    } elseif (Has 'npm') {
        npm install -g pnpm
    } else {
        Info 'npm not found — using PowerShell installer'
        Invoke-WebRequest 'https://get.pnpm.io/install.ps1' -UseBasicParsing | Invoke-Expression
    }

    Refresh-Path
    Ok "pnpm $(pnpm --version)"
}

# ── PoW WASM ───────────────────────────────────────────────────────────────────
if (-not $SkipWasm) {
    Step 'Checking Rust toolchain'
    Ensure-Rust

    Step 'Checking wasm-pack'
    Ensure-WasmPack

    Step 'Building PoW WASM (pow/src/lib.rs)'
    Push-Location "$Root\pow"
    wasm-pack build --target no-modules --out-dir ..\public\pow-wasm
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Pop-Location

    $WasmSrc = "$Root\public\pow-wasm\prism_pow_bg.wasm"
    $WasmDst = "$Root\public\pow.wasm"
    if (Test-Path $WasmSrc) {
        Copy-Item $WasmSrc $WasmDst -Force
        Info 'copied -> public\pow.wasm'
    } else {
        Warn "expected $WasmSrc — skipping copy"
    }
}

# ── Frontend ───────────────────────────────────────────────────────────────────
if (-not $SkipFrontend) {
    Step 'Checking Node.js'
    Ensure-Node

    Step 'Checking pnpm'
    Ensure-Pnpm

    Step 'Installing dependencies'
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Step 'Type-checking (app)'
    pnpm exec tsc -p tsconfig.app.json --noEmit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Step 'Type-checking (worker)'
    pnpm exec tsc -p tsconfig.worker.json --noEmit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Step 'Building frontend'
    pnpm exec vite build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "`nBuild complete. Output in dist/" -ForegroundColor Green
}

Pop-Location
