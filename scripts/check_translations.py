#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# ///
"""
Check that every translation key used in src/ exists in all locale files.

Exit codes:
  0  all keys present
  1  one or more keys missing from a locale file
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Force UTF-8 output on Windows (cp1252 can't encode emojis)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]

# ── Config ─────────────────────────────────────────────────────────────────────

ROOT       = Path(__file__).resolve().parent.parent
SRC_DIR    = ROOT / "src"
I18N_DIR   = ROOT / "src" / "i18n"
LOCALES    = ["en", "zh"]
SRC_GLOBS  = ["*.ts", "*.tsx"]  # passed to Path.rglob()

# ── Colours ────────────────────────────────────────────────────────────────────

USE_COLOR = sys.stdout.isatty()

def c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text

RED    = lambda t: c("31", t)
YELLOW = lambda t: c("33", t)
GREEN  = lambda t: c("32", t)
CYAN   = lambda t: c("36", t)
BOLD   = lambda t: c("1",  t)
DIM    = lambda t: c("2",  t)

# ── Helpers ────────────────────────────────────────────────────────────────────

def flatten(obj: object, prefix: str = "") -> set[str]:
    """Recursively flatten a JSON object into dot-separated keys."""
    keys: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                keys |= flatten(v, full)
            else:
                keys.add(full)
    return keys


def load_locale(name: str) -> set[str]:
    path = I18N_DIR / f"{name}.json"
    with path.open(encoding="utf-8") as f:
        return flatten(json.load(f))


# Matches:  t("key.sub")  or  t('key.sub')
RE_LITERAL = re.compile(r"""\bt\(\s*(?:"([^"]+)"|'([^']+)')\s*[,)]""")
# Matches:  t(`anything`)
RE_TEMPLATE = re.compile(r"""\bt\(\s*`([^`]*)`\s*[,)]""")


def extract_keys(src_dir: Path, globs: list[str]) -> tuple[set[str], list[tuple[Path, str]]]:
    """
    Return (literal_keys, [(file, template_expr), ...]).
    """
    literal: set[str] = set()
    dynamic: list[tuple[Path, str]] = []

    for glob in globs:
        for path in sorted(src_dir.rglob(glob)):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            for m in RE_LITERAL.finditer(text):
                literal.add(m.group(1) or m.group(2))
            for m in RE_TEMPLATE.finditer(text):
                dynamic.append((path.relative_to(ROOT), m.group(1)))

    return literal, dynamic


def section(title: str) -> None:
    print(f"\n{BOLD(title)}")
    print(DIM("─" * 60))


def bullet(symbol: str, text: str) -> None:
    print(f"  {symbol} {text}")

# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    print(BOLD("\n🔍  Translation key checker"))

    # Load locale files
    locales: dict[str, set[str]] = {}
    for name in LOCALES:
        path = I18N_DIR / f"{name}.json"
        if not path.exists():
            print(RED(f"ERROR: locale file not found: {path}"))
            return 1
        locales[name] = load_locale(name)
        print(f"  Loaded {CYAN(name + '.json')}: {len(locales[name])} keys")

    # Extract keys from source
    used_keys, dynamic_keys = extract_keys(SRC_DIR, SRC_GLOBS)
    print(f"  Found {CYAN(str(len(used_keys)))} literal key(s) in src/")
    print(f"  Found {CYAN(str(len(dynamic_keys)))} template literal usage(s) in src/")

    errors = 0
    warnings = 0

    # ── Missing from each locale ──────────────────────────────────────────────

    for name, locale_keys in locales.items():
        missing = sorted(used_keys - locale_keys)
        if missing:
            section(f"❌  Keys used in code but MISSING from {name}.json ({len(missing)})")
            for k in missing:
                bullet(RED("✗"), k)
            errors += len(missing)

    # ── Cross-locale drift ────────────────────────────────────────────────────

    if len(locales) >= 2:
        ref_name = LOCALES[0]
        ref_keys = locales[ref_name]
        for name in LOCALES[1:]:
            other_keys = locales[name]

            in_ref_not_other = sorted(ref_keys - other_keys)
            if in_ref_not_other:
                section(
                    f"⚠️   In {ref_name}.json but missing from {name}.json ({len(in_ref_not_other)})"
                )
                for k in in_ref_not_other:
                    bullet(YELLOW("△"), k)
                warnings += len(in_ref_not_other)

            in_other_not_ref = sorted(other_keys - ref_keys)
            if in_other_not_ref:
                section(
                    f"⚠️   In {name}.json but missing from {ref_name}.json ({len(in_other_not_ref)})"
                )
                for k in in_other_not_ref:
                    bullet(YELLOW("△"), k)
                warnings += len(in_other_not_ref)

    # ── Dynamic / unverifiable keys ───────────────────────────────────────────

    if dynamic_keys:
        section(f"ℹ️   Dynamic template keys — cannot be statically verified ({len(dynamic_keys)})")
        for path, expr in dynamic_keys:
            bullet(DIM("~"), f"{DIM(str(path))}: `{expr}`")

    # ── Summary ───────────────────────────────────────────────────────────────

    print()
    if errors == 0 and warnings == 0:
        print(GREEN("✓  All translation keys are present across all locale files."))
        return 0

    parts = []
    if errors:
        parts.append(RED(f"{errors} missing key(s)"))
    if warnings:
        parts.append(YELLOW(f"{warnings} drift warning(s)"))
    print("Summary: " + ", ".join(parts))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
