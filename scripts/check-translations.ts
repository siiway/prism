// Check translation keys against the source in src/web/.
//
//   bun scripts/check-translations.ts
//
// Exit code 1 when a key used in code is missing from a locale file. Warnings
// (exit code 0): keys that exist in only one locale, and keys no code refers to.
//
// "Unused" is a best guess. A key counts as used when its full name appears as a
// quoted string anywhere in src/web or src/shared (so t("a.b") and labelKey:
// "a.b" both count), or when a template literal could produce it, such as
// `apps.ruleType_${x}` or `${ns}.notFoundTitle`. A template only counts when
// its literal text looks like part of a key and is specific enough: only key
// characters, at least 6 of them, including a dot.
// One that is nearly all interpolation (`${ns}.${key}`) would match almost any
// key, so it is ignored, and keys built that way may be listed as unused when
// they are not.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC_DIR = join(ROOT, "src", "web");
const I18N_DIR = join(SRC_DIR, "i18n");
const LOCALES = ["en", "zh"];

const color = process.stdout.isTTY
  ? (code: string) => (text: string) => `\x1b[${code}m${text}\x1b[0m`
  : () => (text: string) => text;
const red = color("31");
const yellow = color("33");
const green = color("32");
const cyan = color("36");
const bold = color("1");
const dim = color("2");

function flatten(obj: unknown, prefix = ""): Set<string> {
  const keys = new Set<string>();
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const nested of flatten(v, full)) keys.add(nested);
      } else {
        keys.add(full);
      }
    }
  }
  return keys;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

// t("key.sub") or t('key.sub')
const RE_LITERAL = /\bt\(\s*(?:"([^"]+)"|'([^']+)')\s*[,)]/g;
// t(`anything`)
const RE_TEMPLATE = /\bt\(\s*`([^`]*)`\s*[,)]/g;

const SHARED_DIR = join(ROOT, "src", "shared");
const escapeRe = (s: string) => s.replace(/[.*+?^()|[\]\\]/g, "\\$&");

function section(title: string): void {
  console.log(`\n${bold(title)}\n${dim("─".repeat(60))}`);
}

const diff = (a: Set<string>, b: Set<string>) =>
  [...a].filter((k) => !b.has(k)).sort();

console.log(bold("\n🔍  Translation key checker"));

const locales = new Map<string, Set<string>>();
for (const name of LOCALES) {
  const path = join(I18N_DIR, `${name}.json`);
  try {
    locales.set(name, flatten(JSON.parse(readFileSync(path, "utf8"))));
  } catch {
    console.log(red(`ERROR: cannot read locale file: ${path}`));
    process.exit(1);
  }
  console.log(
    `  Loaded ${cyan(`${name}.json`)}: ${locales.get(name)!.size} keys`,
  );
}

const used = new Set<string>();
const dynamic: { file: string; expr: string }[] = [];
for (const file of [...sourceFiles(SRC_DIR)].sort()) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(RE_LITERAL)) used.add(m[1] ?? m[2]);
  for (const m of text.matchAll(RE_TEMPLATE))
    dynamic.push({ file: relative(ROOT, file), expr: m[1] });
}
console.log(`  Found ${cyan(String(used.size))} literal key(s) in src/web/`);
console.log(
  `  Found ${cyan(String(dynamic.length))} template literal usage(s) in src/web/`,
);

let errors = 0;
let warnings = 0;

for (const [name, keys] of locales) {
  const missing = diff(used, keys);
  if (!missing.length) continue;
  section(
    `❌  Keys used in code but MISSING from ${name}.json (${missing.length})`,
  );
  for (const k of missing) console.log(`  ${red("✗")} ${k}`);
  errors += missing.length;
}

const [ref, ...others] = LOCALES;
for (const other of others) {
  for (const [from, to] of [
    [ref, other],
    [other, ref],
  ]) {
    const missing = diff(locales.get(from)!, locales.get(to)!);
    if (!missing.length) continue;
    section(
      `⚠️   In ${from}.json but missing from ${to}.json (${missing.length})`,
    );
    for (const k of missing) console.log(`  ${yellow("△")} ${k}`);
    warnings += missing.length;
  }
}

// ── Unused keys ─────────────────────────────────────────────────────────────

const usageText = [...sourceFiles(SRC_DIR), ...sourceFiles(SHARED_DIR)]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const quoted = new Set(
  [...usageText.matchAll(/["'`]([A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]),
);
const templatePatterns = [...usageText.matchAll(/`([^`]*\$\{[^`]*)`/g)]
  .map((m) => m[1])
  .filter((t) => {
    const literal = t.replace(/\$\{[^}]*\}/g, "");
    return (
      literal.length >= 6 &&
      literal.includes(".") &&
      /^[A-Za-z0-9_.]+$/.test(literal)
    );
  })
  .map(
    (t) => new RegExp("^" + escapeRe(t).replace(/\$\{[^}]*\}/g, ".*") + "$"),
  );
const baseKey = (k: string) => k.replace(/_(one|other|zero|two|few|many)$/, "");
const isUsed = (k: string) => {
  const base = baseKey(k);
  return (
    quoted.has(k) ||
    quoted.has(base) ||
    templatePatterns.some((p) => p.test(k) || p.test(base))
  );
};

const allKeys = new Set([...locales.values()].flatMap((keys) => [...keys]));
const unused = [...allKeys].filter((k) => !isUsed(k)).sort();
let unusedCount = 0;
if (unused.length) {
  section(
    `🗑️   Keys no code refers to — probably dead (${unused.length}, of ${allKeys.size})`,
  );
  for (const k of unused) console.log(`  ${yellow("△")} ${k}`);
  unusedCount = unused.length;
}

console.log(
  dim(
    `\n  ${dynamic.length} t() call(s) build their key at runtime; keys a template could produce are treated as used.`,
  ),
);

console.log();
if (!errors && !warnings && !unusedCount) {
  console.log(
    green("✓  All translation keys are present across all locale files."),
  );
} else {
  const parts = [];
  if (errors) parts.push(red(`${errors} missing key(s)`));
  if (warnings) parts.push(yellow(`${warnings} drift warning(s)`));
  if (unusedCount) parts.push(yellow(`${unusedCount} unused key(s)`));
  console.log(`Summary: ${parts.join(", ")}`);
  if (errors) process.exit(1);
}
