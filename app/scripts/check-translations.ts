// Check translation keys against the frontend source.
//
//   bun scripts/check-translations.ts
//
// The keys the code can use are a fixed set, and this works that set out
// exactly with the TypeScript type checker over src/web and src/shared
// (src/web/tsconfig.json). Nothing is guessed from naming patterns:
//
// - A string literal that is a key uses it: t("a.b"), labelKey: "a.b".
// - A template literal uses every key it can produce. Each `${…}` has a type,
//   and when that type is a union of literals ("email" | "captcha") the
//   template expands to every combination.
// - apiErrors.<code> uses each code the Worker can send
//   (scripts/api-error-codes.ts).
//
// Exit code 1 when:
// - a key the code uses is missing from a locale file, or
// - a key is built from a value whose type is not a fixed set of literals
//   (a plain `string`), because then no one can say which keys it uses.
//   Give the value a literal union type, or map it to full keys.
//
// Warnings (exit code 0): keys in only one locale, and keys nothing uses.

import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { workerErrorCodes } from "./api-error-codes.ts";

const ROOT = resolve(import.meta.dirname, "..");
const I18N_DIR = join(ROOT, "src", "web", "i18n");
const LOCALES = ["en", "zh"];
/** Namespaces keyed by codes the Worker sends, which no client type lists. */
const CODE_TABLES: Record<string, () => Iterable<string>> = {
  // http_error: the client's own code for a failure response that carries
  // none (src/web/lib/api.ts).
  apiErrors: () => [...workerErrorCodes(), "http_error"],
};

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

function section(title: string): void {
  console.log(`\n${bold(title)}\n${dim("─".repeat(60))}`);
}

const diff = (a: Iterable<string>, b: Set<string>) =>
  [...new Set(a)].filter((k) => !b.has(k)).sort();

console.log(bold("\n🔍  Translation key checker"));

// ── Locale files ────────────────────────────────────────────────────────────

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
const allKeys = new Set([...locales.values()].flatMap((keys) => [...keys]));

// A plural key ("a.b_one") is used through its base name ("a.b").
const PLURAL = /_(zero|one|two|few|many|other)$/;
const keyBases = new Set([...allKeys].map((k) => k.replace(PLURAL, "")));
const namespaces = new Set([...allKeys].map((k) => k.split(".")[0]));
const isKey = (s: string) => allKeys.has(s) || keyBases.has(s);

// ── Source ──────────────────────────────────────────────────────────────────

const config = ts.getParsedCommandLineOfConfigFile(
  join(ROOT, "src", "web", "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
);
if (!config) {
  console.log(red("ERROR: cannot read src/web/tsconfig.json"));
  process.exit(1);
}
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();

/** Every value a type can hold, when that is a fixed set of literals. */
function literalValues(type: ts.Type): string[] | null {
  if (type.isUnion()) {
    const out: string[] = [];
    for (const member of type.types) {
      const values = literalValues(member);
      if (!values) return null;
      out.push(...values);
    }
    return out;
  }
  if (type.isStringLiteral()) return [type.value];
  if (type.isNumberLiteral()) return [String(type.value)];
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return [checker.typeToString(type)];
  if (type.flags & ts.TypeFlags.Undefined) return ["undefined"];
  if (type.flags & ts.TypeFlags.Null) return ["null"];
  return null;
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;

/** t(…), i18n.t(…) and i18n.exists(…): the first argument is a key. */
function keyArgument(node: ts.CallExpression): ts.Expression | undefined {
  const callee = node.expression;
  const isTranslator = ts.isIdentifier(callee)
    ? callee.text === "t"
    : ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === "t" || callee.name.text === "exists");
  return isTranslator && node.arguments.length
    ? unwrap(node.arguments[0])
    : undefined;
}

type Where = { file: string; line: number; text: string };
const where = (node: ts.Node): Where => {
  const sf = node.getSourceFile();
  return {
    file: relative(ROOT, sf.fileName).replace(/\\/g, "/"),
    line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    text: node.getText().replace(/\s+/g, " ").slice(0, 70),
  };
};

const used = new Set<string>();
const missing = new Map<string, Where>();
const unresolved: (Where & { why: string })[] = [];
let expanded = 0;

/** The values a template can produce, or why it cannot be known. */
function expand(node: ts.TemplateExpression): string[] | string {
  let out = [node.head.text];
  for (const span of node.templateSpans) {
    const type = checker.getTypeAtLocation(span.expression);
    const values = literalValues(type);
    if (!values)
      return `\${${span.expression.getText()}} is ${checker.typeToString(type)}`;
    out = out.flatMap((pre) => values.map((v) => pre + v + span.literal.text));
  }
  return out;
}

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile || !/\/src\/(web|shared)\//.test(sf.fileName))
    continue;
  const keyArgs = new Set<ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const arg = keyArgument(node);
      if (arg) {
        keyArgs.add(arg);
        if (ts.isStringLiteralLike(arg) && !isKey(arg.text))
          missing.set(arg.text, where(arg));
        if (
          ts.isBinaryExpression(arg) &&
          arg.operatorToken.kind === ts.SyntaxKind.PlusToken
        )
          unresolved.push({
            ...where(arg),
            why: "built with +; use a template literal",
          });
      }
    }
    if (ts.isStringLiteralLike(node) && isKey(node.text)) used.add(node.text);
    if (ts.isTemplateExpression(node)) {
      const head = node.head.text;
      const table = head.endsWith(".") && CODE_TABLES[head.slice(0, -1)];
      // Passed straight to t(): every value it produces must be a key.
      const isKeyArg = keyArgs.has(node);
      // Starts like a key ("admin.…"), so its values must be knowable even
      // when it is stored first and translated later. It may also be
      // something else that happens to start the same way (`audit.${ext}` as
      // a file name), so values that are not keys are not reported missing.
      const looksLikeKey = isKeyArg || namespaces.has(head.split(".")[0]);
      const values = expand(node);
      if (typeof values !== "string") {
        expanded++;
        for (const v of values) {
          if (isKey(v)) used.add(v);
          else if (isKeyArg) missing.set(v, where(node));
        }
      } else if (table && node.templateSpans.length === 1) {
        expanded++;
        for (const code of table()) {
          const key = head + code + node.templateSpans[0].literal.text;
          if (isKey(key)) used.add(key);
          else missing.set(key, where(node));
        }
      } else if (looksLikeKey) {
        unresolved.push({ ...where(node), why: values });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

console.log(`  Found ${cyan(String(used.size))} used key(s) in src/web/`);
console.log(
  `  Expanded ${cyan(String(expanded))} template literal(s) from their types`,
);

// ── Report ──────────────────────────────────────────────────────────────────

let errors = 0;
let warnings = 0;

if (unresolved.length) {
  section(
    `❌  Keys built from values that are not a fixed set (${unresolved.length})`,
  );
  for (const u of unresolved) {
    console.log(`  ${red("✗")} ${u.file}:${u.line}  ${u.text}`);
    console.log(dim(`      ${u.why}`));
  }
  console.log(
    dim(
      "\n  Give each value a literal union type, or map it to full keys, so the\n  keys it can produce are known.",
    ),
  );
  errors += unresolved.length;
}

for (const [name, keys] of locales) {
  const bases = new Set([...keys].map((k) => k.replace(PLURAL, "")));
  const unique = [...new Set([...used, ...missing.keys()])]
    .filter((k) => !keys.has(k) && !bases.has(k))
    .sort();
  if (!unique.length) continue;
  section(
    `❌  Keys used in code but MISSING from ${name}.json (${unique.length})`,
  );
  for (const k of unique) {
    const at = missing.get(k);
    console.log(
      `  ${red("✗")} ${k}${at ? dim(`  (${at.file}:${at.line})`) : ""}`,
    );
  }
  errors += unique.length;
}

const [ref, ...others] = LOCALES;
for (const other of others) {
  for (const [from, to] of [
    [ref, other],
    [other, ref],
  ]) {
    const absent = diff(locales.get(from)!, locales.get(to)!);
    if (!absent.length) continue;
    section(
      `⚠️   In ${from}.json but missing from ${to}.json (${absent.length})`,
    );
    for (const k of absent) console.log(`  ${yellow("△")} ${k}`);
    warnings += absent.length;
  }
}

const unused = [...allKeys]
  .filter((k) => !used.has(k) && !used.has(k.replace(PLURAL, "")))
  .sort();
if (unused.length) {
  section(`🗑️   Keys nothing uses (${unused.length}, of ${allKeys.size})`);
  for (const k of unused) console.log(`  ${yellow("△")} ${k}`);
  warnings += unused.length;
}

console.log();
if (!errors && !warnings) {
  console.log(
    green("✓  Every key is used, and every used key is in every locale."),
  );
} else {
  const parts = [];
  if (errors) parts.push(red(`${errors} error(s)`));
  if (warnings) parts.push(yellow(`${warnings} warning(s)`));
  console.log(`Summary: ${parts.join(", ")}`);
  if (errors) process.exit(1);
}
