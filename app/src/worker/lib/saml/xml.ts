// A small XML element tree, serialized as Exclusive XML Canonicalization
// (https://www.w3.org/TR/xml-exc-c14n/, without comments).
//
// Prism only signs XML it builds itself, so instead of parsing and
// canonicalizing arbitrary documents it writes every element in canonical
// form to begin with: namespace declarations exactly where exclusive c14n
// puts them, attributes in canonical order, no self-closing tags and no
// whitespace between elements. The serialization of any subtree is then
// byte-for-byte what a verifier computes when it canonicalizes that subtree
// out of the full document, which is what XML Signature digests and signs.
//
// Rules this relies on (all hold for the documents in this folder):
// - Namespaces come only from element and attribute prefixes listed in NS;
//   there is no default namespace and no xmlns attribute in `attrs`.
// - A prefix used only inside an attribute value (e.g. xsi:type="xs:string")
//   would not be declared, so don't write such values.

export const NS = {
  samlp: "urn:oasis:names:tc:SAML:2.0:protocol",
  saml: "urn:oasis:names:tc:SAML:2.0:assertion",
  md: "urn:oasis:names:tc:SAML:2.0:metadata",
  ds: "http://www.w3.org/2000/09/xmldsig#",
} as const;

// XML Signature algorithm URIs, for signatures Prism makes and checks.
export const DSIG = NS.ds;
export const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
export const ENVELOPED = `${DSIG}enveloped-signature`;
export const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

type Prefix = keyof typeof NS;

export interface XmlElement {
  /** Qualified name, `prefix:local`, with a prefix from NS. */
  name: string;
  /** Unprefixed attributes; a value of undefined is left out. */
  attrs?: Record<string, string | undefined>;
  children?: XmlNode[];
}

type XmlNode = XmlElement | string;

export function el(
  name: string,
  attrs: Record<string, string | undefined> = {},
  ...children: (XmlNode | null | undefined | false)[]
): XmlElement {
  return {
    name,
    attrs,
    children: children.filter(
      (c): c is XmlNode => c !== null && c !== undefined && c !== false,
    ),
  };
}

function prefixOf(name: string): Prefix {
  const i = name.indexOf(":");
  const prefix = i < 0 ? "" : name.slice(0, i);
  if (!(prefix in NS)) throw new Error(`Unknown XML prefix in ${name}`);
  return prefix as Prefix;
}

// Characters XML 1.0 doesn't allow at all, even escaped: C0 controls other
// than tab, LF and CR, lone surrogates, U+FFFE and U+FFFF. User text (a
// display name) could hold them, and one would make the whole signed
// document unparseable, so they're dropped.
const NOT_XML_CHAR =
  /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/** Text as exclusive c14n writes it. verify.ts canonicalizes XML Prism
 *  receives with it too: digests only match byte for byte. */
export function c14nEscapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;");
}

/** An attribute value as exclusive c14n writes it. */
export function c14nEscapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

const escapeText = (s: string) => c14nEscapeText(s.replace(NOT_XML_CHAR, ""));
const escapeAttr = (s: string) => c14nEscapeAttr(s.replace(NOT_XML_CHAR, ""));

/** Code-point order, which is what c14n sorts by (not locale order). */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(
  node: XmlNode,
  rendered: ReadonlyMap<Prefix, string>,
  out: string[],
): void {
  if (typeof node === "string") {
    out.push(escapeText(node));
    return;
  }
  // Exclusive c14n declares a namespace on an element when the element
  // itself uses it and the nearest output ancestor hasn't already declared
  // it with the same value. Unprefixed attributes use no namespace.
  const prefix = prefixOf(node.name);
  let scope = rendered;
  out.push(`<${node.name}`);
  if (rendered.get(prefix) !== NS[prefix]) {
    out.push(` xmlns:${prefix}="${escapeAttr(NS[prefix])}"`);
    scope = new Map(rendered).set(prefix, NS[prefix]);
  }
  const attrs = Object.entries(node.attrs ?? {})
    .filter((e): e is [string, string] => e[1] !== undefined)
    .sort(([a], [b]) => byCodePoint(a, b));
  for (const [k, v] of attrs) {
    if (k.includes(":") || k === "xmlns")
      throw new Error(`Prefixed attribute ${k} is not supported`);
    out.push(` ${k}="${escapeAttr(v)}"`);
  }
  out.push(">");
  for (const child of node.children ?? []) write(child, scope, out);
  out.push(`</${node.name}>`);
}

/** The exclusive canonical form of `node` as a standalone subtree. */
export function canonicalize(node: XmlElement): string {
  const out: string[] = [];
  write(node, new Map(), out);
  return out.join("");
}

/** A full document: the XML declaration, then the canonical root. */
export function serializeDocument(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${canonicalize(root)}`;
}
