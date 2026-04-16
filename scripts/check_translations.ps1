<#
.SYNOPSIS
    Check that every translation key used in src/ exists in all locale files.

.DESCRIPTION
    Scans src/**/*.ts and src/**/*.tsx for t("key") / t('key') calls,
    then verifies each key exists in every src/i18n/<locale>.json file.
    Also reports cross-locale drift (keys present in one file but not another).

.OUTPUTS
    Exit code 0 = all keys present.
    Exit code 1 = one or more keys missing from a locale file.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────────────

$Root    = Split-Path -Parent $PSScriptRoot
$SrcDir  = Join-Path $Root 'src'
$I18nDir = Join-Path $Root 'src\i18n'
$Locales = @('en', 'zh')

# ── Colour helpers ────────────────────────────────────────────────────────────

function Write-Color {
    param([string]$Text, [string]$Color = 'White')
    Write-Host $Text -ForegroundColor $Color -NoNewline
    Write-Host ''
}

function Write-Section([string]$Title) {
    Write-Host ""
    Write-Host $Title -ForegroundColor White
    Write-Host ('─' * 60) -ForegroundColor DarkGray
}

function Write-Bullet([string]$Symbol, [string]$Text, [string]$Color) {
    Write-Host "  $Symbol " -ForegroundColor $Color -NoNewline
    Write-Host $Text
}

# ── JSON flattening ───────────────────────────────────────────────────────────

function Get-FlatKeys {
    param(
        [Parameter(Mandatory)][object]$Obj,
        [string]$Prefix = ''
    )

    $keys = [System.Collections.Generic.HashSet[string]]::new()

    if ($Obj -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in $Obj.PSObject.Properties) {
            $full = if ($Prefix) { "$Prefix.$($prop.Name)" } else { $prop.Name }
            $child = $prop.Value
            if ($child -is [System.Management.Automation.PSCustomObject]) {
                foreach ($k in (Get-FlatKeys -Obj $child -Prefix $full)) {
                    [void]$keys.Add($k)
                }
            } else {
                [void]$keys.Add($full)
            }
        }
    }

    return $keys
}

# ── Key extraction ────────────────────────────────────────────────────────────

# Literal: t("key.sub") or t('key.sub')
$ReLiteral  = [regex]'\bt\(\s*(?:"([^"]+)"|''([^'']+)'')\s*[,)]'
# Template:  t(`...`)
$ReTemplate = [regex]'(?s)\bt\(\s*`([^`]*)`\s*[,)]'

function Get-UsedKeys {
    param([string]$SrcDir)

    $literal  = [System.Collections.Generic.HashSet[string]]::new()
    $dynamic  = [System.Collections.Generic.List[hashtable]]::new()

    $files = Get-ChildItem -Path $SrcDir -Include '*.ts','*.tsx' -Recurse -File

    foreach ($file in $files) {
        $text = Get-Content -Path $file.FullName -Raw -Encoding UTF8

        foreach ($m in $ReLiteral.Matches($text)) {
            $key = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            [void]$literal.Add($key)
        }

        foreach ($m in $ReTemplate.Matches($text)) {
            $rel = $file.FullName.Substring($Root.Length).TrimStart('\','/')
            $dynamic.Add(@{ File = $rel; Expr = $m.Groups[1].Value })
        }
    }

    return $literal, $dynamic
}

# ── Main ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "🔍  Translation key checker" -ForegroundColor White

# Load locales
$localeSets = @{}
foreach ($name in $Locales) {
    $path = Join-Path $I18nDir "$name.json"
    if (-not (Test-Path $path)) {
        Write-Host "ERROR: locale file not found: $path" -ForegroundColor Red
        exit 1
    }
    $json = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $localeSets[$name] = Get-FlatKeys -Obj $json
    Write-Host "  Loaded " -NoNewline
    Write-Host "$name.json" -ForegroundColor Cyan -NoNewline
    Write-Host ": $($localeSets[$name].Count) keys"
}

# Extract from source
$usedKeys, $dynamicKeys = Get-UsedKeys -SrcDir $SrcDir
Write-Host "  Found " -NoNewline
Write-Host "$($usedKeys.Count)" -ForegroundColor Cyan -NoNewline
Write-Host " literal key(s) in src/"
Write-Host "  Found " -NoNewline
Write-Host "$($dynamicKeys.Count)" -ForegroundColor Cyan -NoNewline
Write-Host " template literal usage(s) in src/"

$totalErrors   = 0
$totalWarnings = 0

# Missing from each locale
foreach ($name in $Locales) {
    $localeKeys = $localeSets[$name]
    $missing = $usedKeys | Where-Object { -not $localeKeys.Contains($_) } | Sort-Object
    if ($missing) {
        Write-Section "❌  Keys used in code but MISSING from $name.json ($($missing.Count))"
        foreach ($k in $missing) {
            Write-Bullet '✗' $k 'Red'
        }
        $totalErrors += $missing.Count
    }
}

# Cross-locale drift
if ($Locales.Count -ge 2) {
    $refName = $Locales[0]
    $refKeys = $localeSets[$refName]
    for ($i = 1; $i -lt $Locales.Count; $i++) {
        $otherName = $Locales[$i]
        $otherKeys = $localeSets[$otherName]

        $inRefNotOther = $refKeys | Where-Object { -not $otherKeys.Contains($_) } | Sort-Object
        if ($inRefNotOther) {
            Write-Section "⚠️   In $refName.json but missing from $otherName.json ($($inRefNotOther.Count))"
            foreach ($k in $inRefNotOther) { Write-Bullet '△' $k 'Yellow' }
            $totalWarnings += $inRefNotOther.Count
        }

        $inOtherNotRef = $otherKeys | Where-Object { -not $refKeys.Contains($_) } | Sort-Object
        if ($inOtherNotRef) {
            Write-Section "⚠️   In $otherName.json but missing from $refName.json ($($inOtherNotRef.Count))"
            foreach ($k in $inOtherNotRef) { Write-Bullet '△' $k 'Yellow' }
            $totalWarnings += $inOtherNotRef.Count
        }
    }
}

# Dynamic keys
if ($dynamicKeys.Count -gt 0) {
    Write-Section "ℹ️   Dynamic template keys — cannot be statically verified ($($dynamicKeys.Count))"
    foreach ($entry in $dynamicKeys) {
        Write-Host "  ~ " -ForegroundColor DarkGray -NoNewline
        Write-Host "$($entry.File)" -ForegroundColor DarkGray -NoNewline
        Write-Host ": ``$($entry.Expr)``"
    }
}

# Summary
Write-Host ""
if ($totalErrors -eq 0 -and $totalWarnings -eq 0) {
    Write-Host "✓  All translation keys are present across all locale files." -ForegroundColor Green
    exit 0
}

$parts = @()
if ($totalErrors)   { $parts += "$totalErrors missing key(s)" }
if ($totalWarnings) { $parts += "$totalWarnings drift warning(s)" }
Write-Host "Summary: $($parts -join ', ')"
exit $(if ($totalErrors) { 1 } else { 0 })
