// Render a user-supplied markdown blob into safe HTML.
//
// The input source comes straight from another user's profile, so it must
// be treated as fully untrusted:
//   1. marked parses CommonMark/GFM into HTML.
//   2. Every <img src> URL in that HTML is pre-registered with the worker's
//      image proxy so the browser can fetch it through /api/proxy/image/<id>
//      (the only URLs the proxy will serve). Registration is one round-trip
//      per unique URL — proxyImageUrl memoizes locally too.
//   3. DOMPurify strips <script>, event handlers, javascript: URLs, and
//      anything outside the conservative allowlist below.
//   4. External <a> links open in a new tab with rel="noopener noreferrer".
//
// Inline <svg> is permitted for things like badges. DOMPurify drops script
// elements, event handlers, and dangerous href schemes from SVG content
// just as it does for HTML, so the static-shapes subset we allow below is
// safe to render. External SVGs referenced via <img src="..."> are
// additionally sanitized by the worker's image proxy.

import DOMPurify from "dompurify";
import { marked } from "marked";
import { proxyImageUrl } from "./api";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const ALLOWED_TAGS = [
  // HTML
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  // SVG — static-content subset. <foreignObject> and <use> are intentionally
  // omitted: the former can embed arbitrary HTML, the latter can pull in
  // external sprite sheets via xlink:href.
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "text",
  "tspan",
  "title",
  "desc",
  "marker",
  "mask",
  "clipPath",
  "pattern",
];
const ALLOWED_ATTR = [
  // HTML
  "href",
  "title",
  "alt",
  "src",
  "class",
  "align",
  "colspan",
  "rowspan",
  "target",
  "rel",
  // SVG geometry / presentation. Event handlers and filter/script attrs are
  // not in this list and DOMPurify strips them either way.
  "viewBox",
  "xmlns",
  "preserveAspectRatio",
  "version",
  "id",
  "role",
  "aria-label",
  "aria-hidden",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "fill-opacity",
  "fill-rule",
  "opacity",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "transform",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "dx",
  "dy",
  "width",
  "height",
];

/**
 * Pull every <img src> URL out of a raw HTML string. Used so we can batch-
 * register the URLs with the image proxy before sanitizing.
 */
function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) urls.add(match[1]);
  return [...urls];
}

/** Render markdown to a sanitized HTML string suitable for dangerouslySetInnerHTML. */
export async function renderMarkdown(source: string): Promise<string> {
  const rawHtml = marked.parse(source, { async: false }) as string;

  // Pre-register every embedded image URL so the proxy can serve it. This
  // is a single round trip per unique URL (proxyImageUrl memoizes), so a
  // README with N images costs at most N requests on first render.
  const urlMap = new Map<string, string>();
  await Promise.all(
    extractImageUrls(rawHtml).map(async (raw) => {
      urlMap.set(raw, await proxyImageUrl(raw));
    }),
  );

  // Rewrite image sources from the pre-resolved map and harden external <a>
  // targets. Hooks are registered globally on DOMPurify — clear first so
  // re-renders don't stack.
  DOMPurify.removeAllHooks();
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (node.nodeName === "IMG" && data.attrName === "src") {
      const proxied = urlMap.get(data.attrValue) ?? "";
      data.attrValue = proxied;
      if (!data.attrValue) data.keepAttr = false;
    }
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      const href = (node as Element).getAttribute("href") ?? "";
      if (href && !href.startsWith("/") && !href.startsWith("#")) {
        (node as Element).setAttribute("target", "_blank");
        (node as Element).setAttribute("rel", "noopener noreferrer ugc");
      }
    }
  });

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Belt-and-braces: drop anything DOMPurify finds suspicious even within
    // allowed tags. The default config already covers this; restating for
    // clarity.
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
    ALLOW_DATA_ATTR: false,
  });
}
