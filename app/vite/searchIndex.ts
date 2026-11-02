// Build-time search index for the command palette (virtual:search-index).
//
// Nothing here lists features by hand. The index is read from the code:
//
// - Pages: every lazy route in src/web/routes.tsx that renders inside the app
//   shell (relative path, no :id-style params). A page's title and
//   description come from its own <PageHeader>/<FormPage>.
// - Cards: any element with a literal id="…" and title={t("…")} in its
//   opening tag (SettingsCard does this) becomes a deep link, /page#id.
// - Sections: pages routed as "…/:tab" are split on {tab === "x" && …}
//   blocks, giving /…/x for each. A section written as its own component,
//   {tab === "x" && <XSection …/>}, is read from the file it's imported from.
// - Keywords: translation keys used inside a card, section or page, kept
//   when their English text looks like a label (short, not a sentence).
//
// The output holds translation keys, not text, so the browser can match a
// query against every language. In dev the module refreshes when an edit
// changes the index.

import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:search-index";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export interface IndexedCard {
  id: string;
  title: string;
  description?: string;
  keywords: string[];
}

export interface IndexedPage {
  path: string;
  title?: string;
  description?: string;
  keywords: string[];
  cards: IndexedCard[];
}

// Keys that name what a string is for rather than what it labels.
const NOT_A_LABEL =
  /(Hint|Desc|Description|Placeholder|Help|Note|Warning|Error|Failed|Saved|Success|Confirm|Body|Tooltip|Prompt|Intro|Empty|Loading)(_one|_other)?$/i;
const MAX_KEYWORDS = 60;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function lookup(dict: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (o, k) =>
        o && typeof o === "object"
          ? (o as Record<string, unknown>)[k]
          : undefined,
      dict,
    );
}

/** The text of the JSX opening tag starting at `start` (at its "<"),
 *  skipping ">" inside {expressions}, strings and comments. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  const letter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? src.length : close + 1;
    } else if (c === "/" && src[i + 1] === "/" && depth > 0) {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
    } else if (c === "'" && letter(src[i - 1]) && letter(src[i + 1])) {
      // An apostrophe in text ("can't"), not a string.
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Index just past the element that opens at `start`: its matching
 *  closing tag, counting nested elements of the same name. */
function elementEnd(src: string, start: number, tag: string): number {
  if (tag.endsWith("/>")) return start + tag.length;
  const name = tag.match(/^<([\w.]+)/)?.[1] ?? "";
  const re = new RegExp(`<(/?)${name.replace(/\./g, "\\.")}(?![\\w.])`, "g");
  re.lastIndex = start + tag.length;
  let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[1]) {
      if (--depth === 0) return src.indexOf(">", m.index) + 1;
    } else if (!openingTag(src, m.index).endsWith("/>")) depth++;
  }
  return src.length;
}

const attrKey = (tag: string, attr: string) =>
  tag.match(new RegExp(`\\b${attr}=\\{t\\("([^"]+)"`))?.[1];

/** Label-like translation keys used in a piece of source: t("…") calls and
 *  bare "ns.key" literals (e.g. a table of labelKey: "…"). */
function keywordsIn(
  src: string,
  en: Record<string, unknown>,
  exclude: Set<string>,
): string[] {
  const found = new Set<string>();
  for (const m of src.matchAll(/"([a-zA-Z]+\.[A-Za-z0-9_.]+)"/g)) {
    const key = m[1];
    if (exclude.has(key) || key.startsWith("common.")) continue;
    if (NOT_A_LABEL.test(key)) continue;
    const text = lookup(en, key);
    if (typeof text !== "string") continue;
    if (text.length > 48 || /[.!?。！？]$/.test(text) || text.includes("{{"))
      continue;
    found.add(key);
  }
  return [...found].slice(0, MAX_KEYWORDS);
}

interface Route {
  path: string;
  file: string;
}

/** Lazy routes inside the app shell: relative paths only, so the public
 *  pages (/login, /u/:name, …) stay out. */
function readRoutes(root: string): Route[] {
  const src = fs.readFileSync(path.join(root, "src/web/routes.tsx"), "utf8");
  const routes: Route[] = [];
  const re =
    /(?:path:\s*"([^"]*)"|index:\s*true)(?:(?!path:|index:)[\s\S])*?import\("\.\/(pages\/[^"]+)"\)/g;
  for (const m of src.matchAll(re)) {
    const rel = m[1];
    if (rel?.startsWith("/")) continue;
    const isAdmin = m[2].startsWith("pages/admin/");
    const base = isAdmin ? "/admin" : "";
    const full =
      rel === undefined || rel === ""
        ? base || "/"
        : `${base}/${rel}`.replace(/\/+/g, "/");
    // Detail pages (:id, :token, …) can't be linked without data; :tab is
    // expanded per section below.
    if (/:(?!tab\b)\w+/.test(full)) continue;
    const file = ["", ".tsx", ".ts"]
      .map((ext) => path.join(root, "src/web", m[2] + ext))
      .find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    // Layout routes (AdminLayout) wrap pages; they aren't one.
    if (file && !/Layout\.tsx?$/.test(file)) routes.push({ path: full, file });
  }
  return routes;
}

function indexFile(
  src: string,
  pagePath: string,
  en: Record<string, unknown>,
): IndexedPage[] {
  // Header: prefer the one with a subtitle (the main state of the page,
  // not e.g. a success screen).
  const headers = [...src.matchAll(/<(PageHeader|FormPage)\b/g)].map((m) =>
    openingTag(src, m.index!),
  );
  const header =
    headers.find((h) => attrKey(h, "subtitle")) ?? headers[0] ?? "";
  const pageTitle = attrKey(header, "tabTitle") ?? attrKey(header, "title");
  const pageDesc = attrKey(header, "subtitle");

  // Cards, each with its own source (opening to closing tag).
  const cardStarts: { index: number; end: number; card: IndexedCard }[] = [];
  // JSX tags follow whitespace, "(", "{" or ">"; TypeScript generics
  // (useState<Foo | null>) follow an identifier and are skipped.
  const seen = new Set<string>();
  for (const m of src.matchAll(/(?<=[\s({>])<[A-Za-z][\w.]*\b/g)) {
    const tag = openingTag(src, m.index!);
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const title = attrKey(tag, "title");
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    cardStarts.push({
      index: m.index!,
      end: elementEnd(src, m.index!, tag),
      card: {
        id,
        title,
        description: attrKey(tag, "description"),
        keywords: [],
      },
    });
  }

  const sections = [...src.matchAll(/\{tab === "([\w-]+)" && \(/g)].map(
    (m) => ({ name: m[1], index: m.index! }),
  );
  const regions = pagePath.includes(":tab")
    ? sections.map((s, i) => ({
        path: pagePath.replace(":tab", s.name),
        start: s.index,
        end: sections[i + 1]?.index ?? src.length,
      }))
    : [{ path: pagePath, start: 0, end: src.length }];

  return regions.map((region) => {
    const cards = cardStarts.filter(
      (c) => c.index >= region.start && c.index < region.end,
    );
    const exclude = new Set(
      [pageTitle, pageDesc].filter((k): k is string => !!k),
    );
    let outside = src.slice(region.start, region.end);
    cards.forEach((c) => {
      const body = src.slice(c.index, Math.min(c.end, region.end));
      c.card.keywords = keywordsIn(
        body,
        en,
        new Set([...exclude, c.card.title, c.card.description ?? ""]),
      );
      outside = outside.replace(body, "");
    });
    return {
      path: region.path,
      title: region.path === pagePath ? pageTitle : undefined,
      description: region.path === pagePath ? pageDesc : undefined,
      keywords: keywordsIn(outside, en, exclude),
      cards: cards.map((c) => c.card),
    };
  });
}

/** Local modules a page imports (its own components and shared ones in
 *  src/web/components), for pages assembled from them, e.g. the audit log. */
function localImports(file: string, root: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
    const base = path.resolve(path.dirname(file), m[1]);
    const rel = path
      .relative(path.join(root, "src/web"), base)
      .replace(/\\/g, "/");
    if (/^(lib|store|i18n)\//.test(rel)) continue;
    const hit = [".tsx", ".ts"]
      .map((ext) => base + ext)
      .find((f) => fs.existsSync(f));
    if (hit) out.push(hit);
  }
  return out;
}

/** The local file a component named `name` is imported from. */
function importedFrom(
  file: string,
  src: string,
  name: string,
): string | undefined {
  const m = src.match(
    new RegExp(
      `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"(\\.{1,2}/[^"]+)"`,
    ),
  );
  if (!m) return undefined;
  const base = path.resolve(path.dirname(file), m[1]);
  return [".tsx", ".ts"].map((ext) => base + ext).find((f) => fs.existsSync(f));
}

const read = (file: string) =>
  fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

export function buildSearchIndex(root: string): IndexedPage[] {
  const en = readJson(path.join(root, "src/web/i18n/en.json"));
  const pages: IndexedPage[] = [];
  for (const route of readRoutes(root)) {
    const src = read(route.file);
    const indexed = indexFile(src, route.path, en);
    if (route.path.includes(":tab")) {
      for (const m of src.matchAll(/\{tab === "([\w-]+)" && <(\w+)/g)) {
        const file = importedFrom(route.file, src, m[2]);
        if (file)
          indexed.push(
            ...indexFile(read(file), route.path.replace(":tab", m[1]), en),
          );
      }
    } else {
      const page = indexed[0];
      const imports = localImports(route.file, root, src);
      // Cards written in the page's own components (e.g. the notification
      // page's Events and Rulesets cards) are deep links on this page too.
      for (const file of imports) {
        for (const card of indexFile(read(file), route.path, en)[0].cards) {
          if (!page.cards.some((c) => c.id === card.id)) page.cards.push(card);
        }
      }
      const known = new Set([
        page.title ?? "",
        page.description ?? "",
        ...page.cards.flatMap((c) => [c.title, ...c.keywords]),
      ]);
      const extra = imports.flatMap((f) => keywordsIn(read(f), en, known));
      page.keywords = [...new Set([...page.keywords, ...extra])].slice(
        0,
        MAX_KEYWORDS,
      );
    }
    pages.push(...indexed);
  }
  return pages;
}

export function searchIndexPlugin(): Plugin {
  let root = process.cwd();
  let last = "";
  const generate = () => {
    last = JSON.stringify(buildSearchIndex(root));
    return last;
  };
  return {
    name: "prism-search-index",
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export default ${generate()};`;
    },
    // Rebuild when a page, the routes or the English strings change, and
    // reload only if the index actually differs.
    hotUpdate({ file, server }) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      if (
        !rel.startsWith("src/web/pages/") &&
        rel !== "src/web/routes.tsx" &&
        rel !== "src/web/i18n/en.json"
      )
        return;
      const before = last;
      if (generate() === before) return;
      const mod = this.environment.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) this.environment.moduleGraph.invalidateModule(mod);
      if (this.environment.name === "client")
        server.ws.send({ type: "full-reload" });
    },
  };
}
