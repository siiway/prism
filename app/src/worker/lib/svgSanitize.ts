// SVG sanitizer for the image proxy.
//
// The SVG is parsed with a strict XML parser and written back out from
// scratch, keeping only allowlisted elements and attributes. Anything the
// parser can't read is rejected rather than repaired, so there is no gap
// between what we checked and what a browser parses. The output holds no
// comments, processing instructions, DTD or foreign namespaces.
//
// The allowlists follow DOMPurify's SVG profile (svg, svgFilters and the svg
// attributes), minus legacy SVG fonts, plus <use> limited to same-document
// references. As in DOMPurify, <animate> and <set> are left out: they can
// rewrite any attribute, including href.

import {
  DOMParser,
  onWarningStopParsing,
  type Element,
  type Node,
} from "@xmldom/xmldom";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const ELEMENTS = new Set([
  "svg",
  "a",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "g",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "stop",
  "style",
  "switch",
  "symbol",
  "text",
  "textPath",
  "title",
  "tspan",
  "use",
  "view",
]);

const ATTRIBUTES = new Set([
  "accumulate",
  "additive",
  "alignment-baseline",
  "amplitude",
  "attributeName",
  "attributeType",
  "azimuth",
  "baseFrequency",
  "baseline-shift",
  "begin",
  "bias",
  "by",
  "class",
  "clip",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "color",
  "color-interpolation",
  "color-interpolation-filters",
  "color-rendering",
  "cx",
  "cy",
  "d",
  "diffuseConstant",
  "direction",
  "display",
  "divisor",
  "dominant-baseline",
  "dur",
  "dx",
  "dy",
  "edgeMode",
  "elevation",
  "end",
  "exponent",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "filterUnits",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "from",
  "fx",
  "fy",
  "gradientTransform",
  "gradientUnits",
  "height",
  "href",
  "id",
  "image-rendering",
  "in",
  "in2",
  "intercept",
  "k",
  "k1",
  "k2",
  "k3",
  "k4",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lang",
  "lengthAdjust",
  "letter-spacing",
  "lighting-color",
  "limitingConeAngle",
  "marker-end",
  "marker-mid",
  "marker-start",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "mask",
  "mask-type",
  "maskContentUnits",
  "maskUnits",
  "max",
  "media",
  "method",
  "min",
  "mode",
  "numOctaves",
  "offset",
  "opacity",
  "operator",
  "order",
  "orient",
  "overflow",
  "paint-order",
  "path",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointer-events",
  "points",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "r",
  "radius",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "restart",
  "result",
  "rotate",
  "rx",
  "ry",
  "scale",
  "seed",
  "shape-rendering",
  "side",
  "slope",
  "spacing",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "style",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "text-anchor",
  "text-decoration",
  "text-orientation",
  "text-rendering",
  "textLength",
  "to",
  "transform",
  "transform-origin",
  "type",
  "unicode-bidi",
  "values",
  "vector-effect",
  "version",
  "viewBox",
  "visibility",
  "width",
  "word-spacing",
  "writing-mode",
  "x",
  "x1",
  "x2",
  "xChannelSelector",
  "y",
  "y1",
  "y2",
  "yChannelSelector",
  "z",
]);

/** What animateTransform may animate. Nothing else can be targeted, so an
 *  animation can't swap in an href or an event handler. */
const ANIMATABLE = new Set([
  "transform",
  "gradientTransform",
  "patternTransform",
]);

/** Raster data URIs, the one non-fragment reference allowed (on <image>
 *  and <feImage>). A nested SVG or an external URL isn't. */
const RASTER_DATA_URI =
  /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]*$/i;

const MAX_DEPTH = 256;

export class SvgRejectedError extends Error {}

/** The sanitized SVG, or a SvgRejectedError when the input isn't
 *  well-formed SVG. */
export function sanitizeSvg(raw: string): string {
  let root: Element | null;
  try {
    root = new DOMParser({
      onError: onWarningStopParsing,
      locator: false,
    }).parseFromString(raw, "image/svg+xml").documentElement;
  } catch {
    throw new SvgRejectedError("unparseable");
  }
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== "svg")
    throw new SvgRejectedError("not_svg");

  const out: string[] = [];
  writeElement(root, out, 0);
  return out.join("");
}

function writeElement(el: Element, out: string[], depth: number) {
  if (depth > MAX_DEPTH) throw new SvgRejectedError("too_deep");
  const name = el.localName ?? "";
  out.push("<", name);
  if (depth === 0) out.push(` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"`);

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const local = attr.localName ?? "";
    const value = attr.value;
    let outName: string;
    if (attr.namespaceURI === null && ATTRIBUTES.has(local)) outName = local;
    else if (attr.namespaceURI === XLINK_NS && local === "href")
      outName = "xlink:href";
    else if (attr.namespaceURI === XML_NS && local === "space")
      outName = "xml:space";
    else continue;

    if (local === "href" && !safeHref(name, value)) continue;
    if (local === "attributeName" && !ANIMATABLE.has(value.trim())) continue;
    out.push(" ", outName, '="', escapeAttr(value), '"');
  }
  out.push(">");

  for (let child = el.firstChild; child; child = child.nextSibling)
    writeNode(child, out, depth + 1);
  out.push("</", name, ">");
}

function writeNode(node: Node, out: string[], depth: number) {
  switch (node.nodeType) {
    case 1: {
      // element
      const el = node as Element;
      if (el.namespaceURI === SVG_NS && ELEMENTS.has(el.localName ?? ""))
        writeElement(el, out, depth);
      // Anything else is dropped with everything inside it.
      return;
    }
    case 3: // text
    case 4: // CDATA
      out.push(escapeText(node.nodeValue ?? ""));
      return;
    // Comments and processing instructions are dropped.
  }
}

/** Same-document references everywhere; raster data URIs on image
 *  elements. */
function safeHref(element: string, value: string): boolean {
  const v = value.trim();
  if (/^#[^\s]*$/.test(v)) return true;
  return (
    (element === "image" || element === "feImage") && RASTER_DATA_URI.test(v)
  );
}

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) =>
  escapeText(s)
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
