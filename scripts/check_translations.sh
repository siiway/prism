#!/usr/bin/env bash
# check_translations.sh — verify all translation keys used in src/ exist in every locale file.
#
# Exit codes:
#   0  all keys present
#   1  one or more keys missing from a locale file
#
# Requires: bash 4+, grep, sort, python3 (for JSON flattening)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/src"
I18N_DIR="$ROOT/src/i18n"
LOCALES=("en" "zh")

# ── Detect Python ──────────────────────────────────────────────────────────────

PYTHON=""
for candidate in python3 python python3.12 python3.11 python3.10; do
    if command -v "$candidate" &>/dev/null; then
        # Verify it actually runs (Windows Store stub exits non-zero with no args)
        if "$candidate" -c "import sys; assert sys.version_info >= (3,8)" 2>/dev/null; then
            PYTHON="$candidate"
            break
        fi
    fi
done
if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3.8+ is required but not found in PATH." >&2
    exit 1
fi

# ── Colour helpers ─────────────────────────────────────────────────────────────

if [ -t 1 ]; then
    RED='\033[31m'; YELLOW='\033[33m'; GREEN='\033[32m'
    CYAN='\033[36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
else
    RED=''; YELLOW=''; GREEN=''; CYAN=''; BOLD=''; DIM=''; RESET=''
fi

section() { printf "\n${BOLD}%s${RESET}\n${DIM}%s${RESET}\n" "$1" "$(printf '─%.0s' {1..60})"; }
bullet()  { printf "  %b%s%b %s\n" "$2" "$1" "$RESET" "$3"; }
info()    { printf "  %s\n" "$1"; }

# ── JSON flattening via python3 ────────────────────────────────────────────────

# Outputs one dot-separated key per line.
flatten_json() {
    local file="$1"
    "$PYTHON" - "$file" <<'PYEOF'
import json, sys

def flatten(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                yield from flatten(v, full)
            else:
                yield full

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

for key in sorted(flatten(data)):
    print(key)
PYEOF
}

# ── Key extraction ─────────────────────────────────────────────────────────────

# Extract literal keys: t("key.sub") and t('key.sub')

extract_literal_keys() {
    local src_dir="$1"
    "$PYTHON" - "$src_dir" <<'PYEOF'
import re, sys
from pathlib import Path

src = Path(sys.argv[1])
RE = re.compile(r'''\bt\(\s*(?:"([^"]+)"|'([^']+)')\s*[,)]''')
keys = set()
for ext in ("*.ts", "*.tsx"):
    for p in src.rglob(ext):
        for m in RE.finditer(p.read_text(errors="ignore")):
            keys.add(m.group(1) or m.group(2))
print('\n'.join(sorted(keys)))
PYEOF
}

# Extract dynamic template keys: t(`...`)
extract_dynamic_keys() {
    local src_dir="$1"
    "$PYTHON" - "$src_dir" <<'PYEOF'
import re, sys
from pathlib import Path

src = Path(sys.argv[1])
RE = re.compile(r'\bt\(\s*`([^`]*)`\s*[,)]')
results = []
for p in sorted(src.rglob("*.ts")) + sorted(src.rglob("*.tsx")):
    text = p.read_text(errors="ignore")
    for m in RE.finditer(text):
        rel = str(p.relative_to(src.parent.parent))
        results.append(f"{rel}\t{m.group(1)}")
print('\n'.join(results))
PYEOF
}

# ── Main ───────────────────────────────────────────────────────────────────────

printf "\n${BOLD}🔍  Translation key checker${RESET}\n"

# Load locales into temp files
declare -A locale_files
for name in "${LOCALES[@]}"; do
    json_file="$I18N_DIR/$name.json"
    if [ ! -f "$json_file" ]; then
        printf "${RED}ERROR: locale file not found: %s${RESET}\n" "$json_file"
        exit 1
    fi
    tmpfile=$(mktemp)
    flatten_json "$json_file" > "$tmpfile"
    locale_files[$name]="$tmpfile"
    count=$(wc -l < "$tmpfile" | tr -d ' \r')
    printf "  Loaded ${CYAN}%s.json${RESET}: %s keys\n" "$name" "$count"
done

# Extract used keys
used_tmp=$(mktemp)
extract_literal_keys "$SRC_DIR" > "$used_tmp" 2>/dev/null || true
# Deduplicate (the grep approach may produce dupes)
sort -u "$used_tmp" -o "$used_tmp"
used_count=$(wc -l < "$used_tmp" | tr -d ' ')

dynamic_tmp=$(mktemp)
extract_dynamic_keys "$SRC_DIR" > "$dynamic_tmp" 2>/dev/null || true
dynamic_count=$(grep -c . "$dynamic_tmp" 2>/dev/null | tr -d ' \r' || echo 0)

printf "  Found ${CYAN}%s${RESET} literal key(s) in src/\n" "$used_count"
printf "  Found ${CYAN}%s${RESET} template literal usage(s) in src/\n" "$dynamic_count"

total_errors=0
total_warnings=0

# Keys missing from each locale
for name in "${LOCALES[@]}"; do
    missing_tmp=$(mktemp)
    # Keys in used_tmp but not in locale file
    comm -23 "$used_tmp" "${locale_files[$name]}" > "$missing_tmp" || true
    missing_count=$(wc -l < "$missing_tmp" | tr -d ' \r')
    if [ "${missing_count:-0}" -gt 0 ] 2>/dev/null; then
        section "❌  Keys used in code but MISSING from $name.json ($missing_count)"
        while IFS= read -r key; do
            bullet "✗" "$RED" "$key"
        done < "$missing_tmp"
        total_errors=$((total_errors + missing_count))
    fi
    rm -f "$missing_tmp"
done

# Cross-locale drift (compare each pair against the reference locale)
ref="${LOCALES[0]}"
for (( i=1; i<${#LOCALES[@]}; i++ )); do
    other="${LOCALES[$i]}"

    in_ref_not_other=$(mktemp)
    comm -23 "${locale_files[$ref]}" "${locale_files[$other]}" > "$in_ref_not_other" || true
    cnt=$(wc -l < "$in_ref_not_other" | tr -d ' \r')
    if [ "${cnt:-0}" -gt 0 ] 2>/dev/null; then
        section "⚠️   In $ref.json but missing from $other.json ($cnt)"
        while IFS= read -r key; do
            bullet "△" "$YELLOW" "$key"
        done < "$in_ref_not_other"
        total_warnings=$((total_warnings + cnt))
    fi
    rm -f "$in_ref_not_other"

    in_other_not_ref=$(mktemp)
    comm -23 "${locale_files[$other]}" "${locale_files[$ref]}" > "$in_other_not_ref" || true
    cnt=$(wc -l < "$in_other_not_ref" | tr -d ' \r')
    if [ "${cnt:-0}" -gt 0 ] 2>/dev/null; then
        section "⚠️   In $other.json but missing from $ref.json ($cnt)"
        while IFS= read -r key; do
            bullet "△" "$YELLOW" "$key"
        done < "$in_other_not_ref"
        total_warnings=$((total_warnings + cnt))
    fi
    rm -f "$in_other_not_ref"
done

# Dynamic keys
if [ "$dynamic_count" -gt 0 ]; then
    section "ℹ️   Dynamic template keys — cannot be statically verified ($dynamic_count)"
    while IFS=$'\t' read -r file expr; do
        printf "  ${DIM}~ %s${RESET}: \`%s\`\n" "$file" "$expr"
    done < "$dynamic_tmp"
fi

# Cleanup temp files
for name in "${LOCALES[@]}"; do rm -f "${locale_files[$name]}"; done
rm -f "$used_tmp" "$dynamic_tmp"

# Summary
printf "\n"
if [ "$total_errors" -eq 0 ] && [ "$total_warnings" -eq 0 ]; then
    printf "${GREEN}✓  All translation keys are present across all locale files.${RESET}\n"
    exit 0
fi

parts=()
[ "$total_errors"   -gt 0 ] && parts+=("${RED}${total_errors} missing key(s)${RESET}")
[ "$total_warnings" -gt 0 ] && parts+=("${YELLOW}${total_warnings} drift warning(s)${RESET}")
printf "Summary: "
printf '%b' "${parts[0]}"
for (( i=1; i<${#parts[@]}; i++ )); do printf ", %b" "${parts[$i]}"; done
printf "\n"

[ "$total_errors" -gt 0 ] && exit 1 || exit 0
