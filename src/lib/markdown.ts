// Render a user-supplied markdown blob into safe HTML.
//
// The input source comes straight from another user's profile, so it must
// be treated as fully untrusted:
//   1. marked parses CommonMark/GFM into HTML.
//   2. DOMPurify strips <script>, event handlers, javascript: URLs, and
//      anything outside the conservative allowlist below.
//   3. Every <img src> is rewritten to route through /api/proxy/image so
//      the viewer's IP is never sent to a third-party host and SVGs are
//      sanitized server-side.
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

/** Render markdown to a sanitized HTML string suitable for dangerouslySetInnerHTML. */
export function renderMarkdown(source: string): string {
  const rawHtml = marked.parse(source, { async: false }) as string;

  // Rewrite image sources to flow through the sanitizing image proxy and
  // harden external <a> targets. Hooks are registered globally on DOMPurify
  // — clear first so re-renders don't stack.
  DOMPurify.removeAllHooks();
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (node.nodeName === "IMG" && data.attrName === "src") {
      const proxied = proxyImageUrl(data.attrValue);
      data.attrValue = proxied || "";
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
