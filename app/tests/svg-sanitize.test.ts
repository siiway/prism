import { describe, expect, test } from "bun:test";
import { SvgRejectedError, sanitizeSvg } from "../src/worker/lib/svgSanitize";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (body: string, attrs = "") =>
  `<svg ${NS} ${XLINK}${attrs}>${body}</svg>`;

describe("sanitizeSvg", () => {
  test("keeps ordinary drawing markup", () => {
    const input = svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<rect width="10" height="10" fill="url(#g)" style="opacity:.5"/>' +
        '<use xlink:href="#g"/><text x="1">a &amp; b</text>',
      ' viewBox="0 0 10 10"',
    );
    const out = sanitizeSvg(input);
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).toContain('<linearGradient id="g">');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('<use xlink:href="#g">');
    expect(out).toContain("a &amp; b");
  });

  test("drops scripts, handlers and foreign content", () => {
    const out = sanitizeSvg(
      svg(
        '<script>alert(1)</script><g onclick="alert(1)" onload="x"/>' +
          '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>' +
          '<set attributeName="onclick" to="alert(1)"/><animate attributeName="href"/>' +
          "<!-- c --><?pi x?>",
        ' onload="alert(1)"',
      ),
    );
    for (const bad of [
      "script",
      "onclick",
      "onload",
      "foreignObject",
      "div",
      "set",
      "animate",
      "<!--",
      "<?",
    ])
      expect(out).not.toContain(bad);
  });

  test("only same-document and raster data references survive", () => {
    const out = sanitizeSvg(
      svg(
        '<a href="javascript:alert(1)"><use href="https://evil.example/s.svg#x"/></a>' +
          '<image href="data:image/png;base64,AAAA"/>' +
          '<image xlink:href="data:image/svg+xml;base64,AAAA"/>' +
          '<use href="#ok"/>',
      ),
    );
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("svg+xml");
    expect(out).toContain('href="data:image/png;base64,AAAA"');
    expect(out).toContain('href="#ok"');
  });

  test("animateTransform can only target transforms", () => {
    const out = sanitizeSvg(
      svg(
        '<animateTransform attributeName="transform" type="rotate"/>' +
          '<animateTransform attributeName="href" to="javascript:alert(1)"/>',
      ),
    );
    expect(out).toContain('attributeName="transform"');
    expect(out).not.toContain('attributeName="href"');
  });

  test("escapes text and attribute values on the way out", () => {
    const out = sanitizeSvg(
      svg('<title>&lt;script&gt;</title><g id="a&quot;b&lt;c"/>'),
    );
    expect(out).toContain("<title>&lt;script&gt;</title>");
    expect(out).toContain('id="a&quot;b&lt;c"');
  });

  test("rejects malformed and non-SVG input instead of repairing it", () => {
    for (const bad of [
      // Nested-tag tricks that beat the old regex filter.
      svg("<scr<script>x</script>ipt>alert(1)</script>"),
      `<svg/onload=alert(1)>`,
      svg("<ifr<iframe/>ame src=x>"),
      // Entities: undeclared, or declared in a DTD (never expanded).
      svg("<text>&nbsp;</text>"),
      `<!DOCTYPE svg [<!ENTITY a "x">]>${svg("<text>&a;</text>")}`,
      // Not SVG at all.
      `<html xmlns="http://www.w3.org/1999/xhtml"/>`,
      `<svg xmlns="urn:not-svg"/>`,
      "",
    ])
      expect(() => sanitizeSvg(bad)).toThrow(SvgRejectedError);
  });

  test("drops a DOCTYPE without an internal subset", () => {
    const out = sanitizeSvg(
      `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${svg("<rect/>")}`,
    );
    expect(out).toBe(`<svg ${NS} ${XLINK}><rect></rect></svg>`);
  });

  test("rejects absurd nesting", () => {
    const deep = "<g>".repeat(300) + "</g>".repeat(300);
    expect(() => sanitizeSvg(svg(deep))).toThrow(SvgRejectedError);
  });

  test("output parses back to the same thing", () => {
    const once = sanitizeSvg(
      svg(
        '<g transform="rotate(5)"><path d="M0 0L1 1"/><text>x &gt; y</text></g>',
      ),
    );
    expect(sanitizeSvg(once)).toBe(once);
  });
});
