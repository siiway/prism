// Writes NOTICE.md at the repository root: every third-party package that
// ships in the build, grouped by license.
//
//   bun run notice            build, then write NOTICE.md
//   bun scripts/notice.ts     write NOTICE.md from the last build
//   bun scripts/notice.ts --check
//                             fail if NOTICE.md doesn't match the last build
//
// The package list comes from dist/packages/*.json, which vite/packages.ts
// writes during `vite build`. License texts come from each package's LICENSE,
// COPYING or NOTICE files in node_modules.
//
// Each license file is split into the package's own notice (the copyright and
// author lines above the license) and the license text. Packages whose texts
// match, ignoring line wrapping, quotes and titles, are listed together with
// their notices above one copy of the text.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as prettier from "prettier";
import { ROOT, fail, ok, parseArgs } from "./lib.ts";

const USAGE = `Usage: bun scripts/notice.ts [--check]

  --check       Fail if NOTICE.md is out of date instead of writing it
  -h, --help    Show this help`;

const { flags } = parseArgs(
  process.argv.slice(2),
  { flags: ["--check"] },
  USAGE,
);

const NOTICE = join(ROOT, "..", "NOTICE.md");
const LISTS = join(ROOT, "dist", "packages");

/** Third-party files checked into public/, with their license files. */
const VENDORED: Package[] = [
  {
    name: "pako",
    version: "3.0.1",
    license: "(MIT AND Zlib)",
    files: ["public/vendor/pako.LICENSE.txt"],
  },
];

/** Notices for packages that ship without a license file, taken from the
 *  license in their source repository. */
const NOTICES: Record<string, string[]> = {
  // https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE
  "@fluentui/react-icons": ["Copyright (c) 2020 Microsoft Corporation"],
};

interface Package {
  name: string;
  version: string;
  /** The package.json license field. */
  license: string;
  /** License files, relative to the app. */
  files: string[];
}

interface Listed {
  pkg: Package;
  notice: string[];
  /** Set when the package has no license file of its own. */
  noFile?: boolean;
}

interface Variant {
  text: string;
  packages: Listed[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

// Where a license text begins, and which license it is. The first match in a
// file wins, so a preamble naming the license counts as the start.
const KNOWN: [RegExp, (text: string) => string][] = [
  [/Permission is hereby granted, free of charge/i, () => "MIT"],
  [/Apache License/i, () => "Apache-2.0"],
  [
    /Redistribution and use in source and binary forms/i,
    (t) =>
      /Neither the name|names of (its|the) contributors/i.test(t)
        ? "BSD-3-Clause"
        : "BSD-2-Clause",
  ],
  [
    /Permission to use, copy, modify, and\/?or distribute/i,
    (t) =>
      /provided that the above copyright notice/i.test(t) ? "ISC" : "0BSD",
  ],
  [/GNU LESSER GENERAL PUBLIC LICENSE/, () => "LGPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE/, () => "GPL-3.0"],
  [/Mozilla Public License/i, () => "MPL-2.0"],
];

/** A line that names the license rather than granting it, like "MIT License". */
const TITLE = /^\(?(the )?[\w .-]*licen[cs]e( \(\w+\))?\)?$/i;

function licenseOf(pkg: Record<string, unknown>): string {
  const field = pkg.license ?? pkg.licenses;
  if (typeof field === "string") return field;
  const list = (Array.isArray(field) ? field : [field]) as {
    type?: string;
  }[];
  const types = list.map((l) => l?.type).filter(Boolean);
  return types.length ? types.join(" OR ") : "UNKNOWN";
}

function bundled(): Package[] {
  if (!existsSync(LISTS)) {
    fail("dist/packages is missing. Run `bun run notice` to build first.");
  }
  const dirs = new Set<string>();
  for (const file of readdirSync(LISTS).filter((f) => f.endsWith(".json"))) {
    for (const dir of JSON.parse(readFileSync(join(LISTS, file), "utf8"))) {
      dirs.add(dir);
    }
  }
  return [...dirs].map((dir) => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, dir, "package.json"), "utf8"),
    );
    return {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      files: readdirSync(join(ROOT, dir))
        .filter((f) => LICENSE_FILE.test(f))
        .sort()
        .map((f) => `${dir}/${f}`),
    };
  });
}

/** Split a license file into the package's notice lines and the license. */
function split(raw: string, fallback: string) {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());
  let start = lines.length;
  let license = fallback;
  for (const [pattern, name] of KNOWN) {
    const at = lines.findIndex((l) => pattern.test(l));
    if (at >= 0 && at < start) {
      start = at;
      license = name(raw);
    }
  }
  if (start === lines.length) start = 0;
  // Only copyright and author lines: some files open with other prose, like
  // marked's note to its contributors.
  const notice = lines
    .slice(0, start)
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter((l) => /copyright|©|\(c\)|author|all rights reserved/i.test(l));
  let body = lines.slice(start);
  while (body.length && (!body[0].trim() || TITLE.test(body[0].trim()))) {
    body.shift();
  }
  // Apache's appendix only shows how to apply the license. Some packages
  // fill in its copyright line; keep that as their notice and drop the rest.
  const end = body.findIndex((l) => /END OF TERMS AND CONDITIONS/.test(l));
  if (license === "Apache-2.0" && end >= 0) {
    for (const l of body.slice(end + 1)) {
      if (/^\s*Copyright\b/.test(l) && !l.includes("[yyyy]")) {
        notice.push(l.trim());
      }
    }
    body = body.slice(0, end + 1);
  }
  return { license, notice, text: body.join("\n").trim() };
}

/** Texts that differ only in wrapping, punctuation or case are the same. */
const sameText = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const packages = [
  ...new Map(
    [...bundled(), ...VENDORED].map((p) => [`${p.name}@${p.version}`, p]),
  ).values(),
].sort(
  (a, b) =>
    a.name.localeCompare(b.name, "en") ||
    a.version.localeCompare(b.version, "en"),
);

// license -> text key -> variant
const sections = new Map<string, Map<string, Variant>>();
const add = (license: string, text: string, listed: Listed) => {
  const variants = sections.get(license) ?? new Map<string, Variant>();
  sections.set(license, variants);
  const key = sameText(text);
  const variant = variants.get(key) ?? { text, packages: [] };
  variants.set(key, variant);
  variant.packages.push(listed);
};

const noFile: Package[] = [];
for (const pkg of packages) {
  if (pkg.files.length === 0) {
    noFile.push(pkg);
    continue;
  }
  for (const file of pkg.files) {
    const raw = readFileSync(join(ROOT, file), "utf8");
    const { license, notice, text } = split(raw, pkg.license);
    // Some packages (Fluent UI's) open with their own name.
    const own = notice.filter((l) => l !== pkg.name);
    add(license, text, { pkg, notice: own });
  }
}

// A package without a license file goes with the most common text of the
// first license it names that's already here.
const unmatched: Package[] = [];
for (const pkg of noFile) {
  const names = pkg.license.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/);
  const license = names.find((n) => sections.has(n));
  if (!license) {
    unmatched.push(pkg);
    continue;
  }
  const common = [...sections.get(license)!.values()].sort(
    (a, b) => b.packages.length - a.packages.length,
  )[0];
  common.packages.push({ pkg, notice: NOTICES[pkg.name] ?? [], noFile: true });
}

const npm = (name: string) => `https://www.npmjs.com/package/${name}`;
const count = (variants: Map<string, Variant>) =>
  new Set([...variants.values()].flatMap((v) => v.packages.map((p) => p.pkg)))
    .size;

function fence(text: string): string {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

function item({ pkg, notice, noFile }: Listed): string {
  const parts = [`[${pkg.name}](${npm(pkg.name)}) ${pkg.version}`];
  // Wrapped lines continue a statement; a new copyright line starts one.
  if (notice.length) {
    parts.push(
      notice
        .map((l, i) =>
          i > 0 && /^(Copyright|\(c\)|©|Author)/i.test(l) ? `; ${l}` : ` ${l}`,
        )
        .join("")
        .trim(),
    );
  }
  if (noFile) parts.push("(no license file in the package)");
  return `- ${parts.join(": ")}`.replace(/: \(no license/, " (no license");
}

const order = [...sections].sort(
  ([a, x], [b, y]) => count(y) - count(x) || a.localeCompare(b, "en"),
);

const out: string[] = [
  "# Notice",
  "<!-- Generated by app/scripts/notice.ts. Run `bun run notice` in app/ to update it. -->",
  "Prism is licensed under the GNU General Public License 3.0 (see [LICENSE](./LICENSE)). " +
    `Its build includes ${packages.length} third-party packages, listed below by license: ` +
    order.map(([name, v]) => `${name} (${count(v)})`).join(", ") +
    ". Each list gives the packages' own copyright notices, followed by the license text they share.",
];
for (const [name, variants] of order) {
  out.push(`## ${name}`);
  const list = [...variants.values()].sort(
    (a, b) => b.packages.length - a.packages.length,
  );
  list.forEach((variant, i) => {
    if (i > 0) out.push("These use a different wording:");
    out.push(
      variant.packages
        .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name, "en"))
        .map(item)
        .join("\n"),
      fence(variant.text),
    );
  });
}
if (unmatched.length) {
  out.push(
    "## Other",
    "These packages include no license text. Their package metadata names the license.",
    unmatched
      .map((p) => `- [${p.name}](${npm(p.name)}) ${p.version}: ${p.license}`)
      .join("\n"),
  );
}

const markdown = await prettier.format(out.join("\n\n") + "\n", {
  ...(await prettier.resolveConfig(NOTICE)),
  filepath: NOTICE,
});

const current = existsSync(NOTICE) ? readFileSync(NOTICE, "utf8") : "";
if (flags.has("--check")) {
  if (current.replace(/\r\n/g, "\n") !== markdown) {
    fail("NOTICE.md is out of date. Run `bun run notice` in app/.");
  }
  ok(`NOTICE.md lists ${packages.length} packages`);
} else {
  writeFileSync(NOTICE, markdown);
  ok(`NOTICE.md: ${packages.length} packages under ${sections.size} licenses`);
}
