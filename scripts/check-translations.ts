// Check that every translation key used in src/web/ exists in all locale files.
//
//   bun scripts/check-translations.ts
//
// Exit code 1 when a key used in code is missing from a locale file. Keys that
// exist in only one locale are reported as warnings.

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

if (dynamic.length) {
  section(
    `ℹ️   Dynamic template keys — cannot be statically verified (${dynamic.length})`,
  );
  for (const { file, expr } of dynamic)
    console.log(`  ${dim("~")} ${dim(file)}: \`${expr}\``);
}

console.log();
if (!errors && !warnings) {
  console.log(
    green("✓  All translation keys are present across all locale files."),
  );
} else {
  const parts = [];
  if (errors) parts.push(red(`${errors} missing key(s)`));
  if (warnings) parts.push(yellow(`${warnings} drift warning(s)`));
  console.log(`Summary: ${parts.join(", ")}`);
  if (errors) process.exit(1);
}
