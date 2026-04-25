// Methods for proving control of a domain.
// Each method checks the same token in a different place, so users can pick
// whichever they have access to: DNS records, a well-known file, or a meta tag.

export const VERIFICATION_METHODS = [
  "dns-txt",
  "http-file",
  "html-meta",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export function isVerificationMethod(v: unknown): v is VerificationMethod {
  return v === "dns-txt" || v === "http-file" || v === "html-meta";
}

export interface MethodInstructions {
  txt_record: string;
  txt_value: string;
  http_path: string;
  http_url: string;
  http_value: string;
  meta_tag: string;
}

export function methodInstructions(
  domain: string,
  token: string,
): MethodInstructions {
  return {
    txt_record: `_prism-verify.${domain}`,
    txt_value: `prism-verify=${token}`,
    http_path: `/.well-known/prism-verify-${token}.txt`,
    http_url: `https://${domain}/.well-known/prism-verify-${token}.txt`,
    http_value: `prism-verify=${token}`,
    meta_tag: `<meta name="prism-verify" content="${token}">`,
  };
}

const FETCH_TIMEOUT_MS = 10_000;
const HTML_MAX_BYTES = 1 << 20; // 1 MiB

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Prism-Domain-Verify/1.0" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDnsTxt(
  domain: string,
  token: string,
): Promise<boolean> {
  try {
    const hostname = `_prism-verify.${domain}`;
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      Answer?: Array<{ type: number; data: string }>;
    };
    const expected = `"prism-verify=${token}"`;
    return (data.Answer ?? []).some(
      (r) => r.type === 16 && r.data === expected,
    );
  } catch {
    return false;
  }
}

export async function checkHttpFile(
  domain: string,
  token: string,
): Promise<boolean> {
  const url = `https://${domain}/.well-known/prism-verify-${token}.txt`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return false;
  const text = await readBoundedText(res, 4096);
  return text.trim() === `prism-verify=${token}`;
}

export async function checkHtmlMeta(
  domain: string,
  token: string,
): Promise<boolean> {
  const url = `https://${domain}/`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return false;
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) return false;
  const html = await readBoundedText(res, HTML_MAX_BYTES);
  return matchMetaTag(html, "prism-verify", token);
}

export async function checkMethod(
  method: VerificationMethod,
  domain: string,
  token: string,
): Promise<boolean> {
  switch (method) {
    case "dns-txt":
      return checkDnsTxt(domain, token);
    case "http-file":
      return checkHttpFile(domain, token);
    case "html-meta":
      return checkHtmlMeta(domain, token);
  }
}

// Try methods in order, return the first one that succeeds.
export async function tryAnyMethod(
  domain: string,
  token: string,
  methods: readonly VerificationMethod[] = VERIFICATION_METHODS,
): Promise<VerificationMethod | null> {
  for (const m of methods) {
    if (await checkMethod(m, domain, token)) return m;
  }
  return null;
}

async function readBoundedText(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  let total = 0;
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (total >= maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
    }
  }
  out += decoder.decode();
  return out;
}

// Match <meta name="<name>" content="<content>"> with attributes in any order
// and quoted with ", ', or unquoted. Names are case-insensitive; content is exact.
function matchMetaTag(html: string, name: string, content: string): boolean {
  const tagRe = /<meta\b[^>]*>/gi;
  const attrRe = (key: string) =>
    new RegExp(
      String.raw`\b${key}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`,
      "i",
    );
  const nameRe = attrRe("name");
  const contentRe = attrRe("content");
  for (const tag of html.match(tagRe) ?? []) {
    const n = nameRe.exec(tag);
    const c = contentRe.exec(tag);
    if (!n || !c) continue;
    const tagName = (n[1] ?? n[2] ?? n[3] ?? "").toLowerCase();
    const tagContent = c[1] ?? c[2] ?? c[3] ?? "";
    if (tagName === name.toLowerCase() && tagContent === content) return true;
  }
  return false;
}
