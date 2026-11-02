// Every API error code the Worker can send. The client translates each one from
// apiErrors.<code> (see src/worker/lib/apiError.ts), so this list is what
// apiErrors has to cover, and all it needs to hold.
//
// Used by tests/api-error-codes.test.ts (every code has a translation) and
// scripts/check-translations.ts (which apiErrors keys are used).

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");

export interface Source {
  file: string;
  text: string;
}

function sources(dir: string): Source[] {
  const out: Source[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "migrations") out.push(...sources(p));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      out.push({ file: p, text: readFileSync(p, "utf8") });
    }
  }
  return out;
}

/** The Worker's TypeScript sources, without migrations. */
export const workerSources = (): Source[] => sources(join(ROOT, "src/worker"));

/** Blank out comments and drop log lines so prose about errors doesn't
 *  count. Comments are found by the TypeScript parser: a regex reads the
 *  `/*` in a line comment like `// /users/:id/* routes` as the start of a
 *  block comment and loses the code after it. */
export function stripComments(text: string): string {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest);
  const ranges = new Map<number, number>();
  const add = (found: ts.CommentRange[] | undefined) =>
    found?.forEach((r) => ranges.set(r.pos, r.end));
  const visit = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);
  let out = "";
  let last = 0;
  for (const [pos, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (pos < last) continue;
    out += text.slice(last, pos) + text.slice(pos, end).replace(/[^\n]/g, " ");
    last = end;
  }
  return (out + text.slice(last)).replace(/^.*\bconsole\.\w+\(.*$/gm, "");
}

/** Every code the worker can send: `error: "x"` and `?? "x"` literals, plus
 *  the ones helpers return indirectly. */
export function workerErrorCodes(worker = workerSources()): Set<string> {
  const read = (path: string) =>
    worker.find((f) => f.file.replace(/\\/g, "/").endsWith(path))!.text;
  const codes = new Set<string>();
  for (const { text } of worker) {
    const src = stripComments(text);
    for (const m of src.matchAll(/\berror:\s*"([a-z][a-z0-9_]*)"/g))
      codes.add(m[1]);
    for (const m of src.matchAll(
      /\berror:\s*[\w.]+\s*\?\?\s*"([a-z][a-z0-9_]*)"/g,
    ))
      codes.add(m[1]);
  }
  // Capability denials and outbound-URL checks return bare codes.
  for (const path of ["lib/userCapabilities.ts", "lib/safeFetch.ts"])
    for (const m of stripComments(read(path)).matchAll(
      /return "([a-z][a-z0-9_]*)";/g,
    ))
      if (m[1].includes("_")) codes.add(m[1]);
  // Redirect URI reasons become `redirect_uri_<reason>`.
  const reasons = /export type RedirectUriReason =([^;]*);/.exec(
    read("lib/redirectUri.ts"),
  );
  for (const m of reasons![1].matchAll(/"([a-z_]+)"/g))
    codes.add(`redirect_uri_${m[1]}`);
  codes.add(/MIGRATIONS_PENDING = "([a-z_]+)"/.exec(read("lib/schema.ts"))![1]);
  return codes;
}
