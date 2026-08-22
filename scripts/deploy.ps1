#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy Prism: build, apply pending D1 migrations, then publish the Worker.
.DESCRIPTION
    Order matters. The build runs first so a compile error stops the deploy
    before anything touches production. Migrations run next, because Prism's
    migrations are additive - the new column has to exist before the code that
    reads it goes live, and the currently-deployed code ignores columns it does
    not know about.
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipMigrations,
    [switch]$MigrationsOnly,
    [switch]$DryRun,
    [Alias('y')][switch]$Yes,
    [string]$Database = 'prism-db',
    [string]$PackageManager = 'bun'
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

try {
    # ── Helpers ────────────────────────────────────────────────────────────────
    function Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
    function Info([string]$msg) { Write-Host "    $msg" }
    function Ok([string]$msg)   { Write-Host "    [ok] $msg" -ForegroundColor Green }
    function Warn([string]$msg) { Write-Warning "    $msg" }

    function Has([string]$cmd) {
        return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
    }

    # Run a command, or just show it under -DryRun.
    function Invoke-Step([string[]]$cmd) {
        if ($DryRun) { Info "would run: $($cmd -join ' ')"; return }
        & $cmd[0] $cmd[1..($cmd.Length - 1)]
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    # wrangler comes from the project's dev dependencies, invoked through
    # whichever package manager the build used.
    function Invoke-Wrangler([string[]]$wranglerArgs, [switch]$IgnoreFailure) {
        $cmd = if ($PackageManager -eq 'pnpm') {
            @('pnpm', 'exec', 'wrangler') + $wranglerArgs
        } else {
            @('bunx', 'wrangler') + $wranglerArgs
        }
        if ($DryRun) { Info "would run: $($cmd -join ' ')"; return }
        & $cmd[0] $cmd[1..($cmd.Length - 1)]
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0 -and -not $IgnoreFailure) {
            exit $LASTEXITCODE
        }
    }

    # ── Preflight ──────────────────────────────────────────────────────────────
    Step 'Preflight'
    if ($PackageManager -eq 'pnpm') {
        if (-not (Has 'pnpm')) { throw 'pnpm not found - run scripts/build.ps1 first' }
    } elseif (-not (Has 'bun')) {
        throw 'bun not found - see scripts/build.ps1'
    }
    Ok "package manager: $PackageManager"

    $workerName = (Select-String -Path (Join-Path $Root 'wrangler.jsonc') `
        -Pattern '"name"\s*:\s*"([^"]*)"' | Select-Object -First 1).Matches.Groups[1].Value
    Info "worker:   $workerName"
    Info "database: $Database"

    if (Has 'git') {
        $status = git status --porcelain 2>$null
        if ($LASTEXITCODE -eq 0) {
            if ($status) { Warn 'working tree has uncommitted changes - deploying them anyway' }
            Info "commit:   $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
        }
    }

    # ── Build ──────────────────────────────────────────────────────────────────
    if (-not $SkipBuild -and -not $MigrationsOnly) {
        Step 'Building'
        if ($DryRun) {
            Info "would run: scripts/build.ps1 -PackageManager $PackageManager"
        } else {
            & (Join-Path $PSScriptRoot 'build.ps1') -PackageManager $PackageManager
            if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
    } else {
        Step 'Skipping build'
        if (-not $MigrationsOnly -and -not (Test-Path (Join-Path $Root 'wrangler.json'))) {
            Warn 'no root wrangler.json - wrangler will re-bundle from source instead of'
            Warn 'using the Vite build. Run without -SkipBuild for a normal deploy.'
        }
    }

    # ── Migrations ─────────────────────────────────────────────────────────────
    if (-not $SkipMigrations) {
        Step 'Pending migrations'
        Invoke-Wrangler @('d1', 'migrations', 'list', $Database, '--remote') -IgnoreFailure
    }

    # ── Confirm ────────────────────────────────────────────────────────────────
    if (-not $Yes -and -not $DryRun) {
        $target = 'migrations + deploy'
        if ($MigrationsOnly)  { $target = 'migrations only' }
        if ($SkipMigrations)  { $target = 'deploy only' }
        Write-Host ''
        $reply = Read-Host "Apply to PRODUCTION ($target)? [y/N]"
        if ($reply -notmatch '^(y|yes)$') { Write-Host 'Aborted.'; exit 1 }
    }

    if (-not $SkipMigrations) {
        Step 'Applying migrations'
        Invoke-Wrangler @('d1', 'migrations', 'apply', $Database, '--remote')
        Ok 'migrations applied'
    }

    # ── Deploy ─────────────────────────────────────────────────────────────────
    if ($MigrationsOnly) {
        Write-Host "`nMigrations applied. Skipped deploy (-MigrationsOnly)." -ForegroundColor Green
        exit 0
    }

    Step 'Deploying'
    Invoke-Wrangler @('deploy')

    Write-Host "`nDeploy complete." -ForegroundColor Green
}
finally {
    Pop-Location
}
