// Validation + matching for OAuth redirect_uri values.
//
// Raw-string matching (`registered.includes(uri)`) is unsafe: WHATWG /
// RFC 3986 URL parsing means two strings that *look* alike can resolve to
// different hosts (userinfo smuggling, fragment-based confusion, scheme
// drift). Equally, registration must reject URIs whose host doesn't match
// what a consent UI would render up to the path.
//
// Each registered redirect URI now carries a match *type*:
//   • equals   — normalized (scheme, host:port, pathname, search) equality.
//                The safest option; used for legacy string entries too.
//   • wildcard — a glob. Scheme, host, port and path+query are matched one
//                by one: `*` in the host stays within a label, `*` as the
//                port allows any port, and in the path or query it matches
//                any run of characters.
//   • regex    — an arbitrary regular expression, anchored full-match.
//                Powerful and dangerous (`.*` allows *any* redirect URI).
//
// An app with an *empty* redirect URI list runs in "learn" mode: the first
// safe redirect URI that is successfully used gets pinned as an `equals`
// entry, after which the app is locked to it.
//
// Rules enforced for `equals` (and every candidate, regardless of type):
//   • scheme is exactly https:, OR http: against a loopback host
//     (localhost / 127.0.0.1 / [::1]) for local-development clients
//   • no userinfo (`user:pass@`) — this is the host-confusion vector
//   • no fragment (RFC 6749 §3.1.2 forbids it on the registered URI;
//     the authorization server appends its own response params instead)
//   • match compares normalized (scheme, host:port, pathname, search) —
//     never the raw string

import {
  REDIRECT_URI_MATCH_TYPES,
  type RedirectUri,
  type RedirectUriMatchType,
} from "../../shared/api";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type RedirectUriEntry = RedirectUri;

function tryParse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/**
 * Tolerantly parse the stored `redirect_uris` column. Accepts both the new
 * object form (`[{type,value}]`) and the legacy string form (`["https://…"]`,
 * treated as `equals` entries). Never throws; returns `[]` on garbage.
 */
export function parseRedirectUris(
  raw: string | null | undefined,
): RedirectUriEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RedirectUriEntry[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      out.push({ type: "equals", value: item });
    } else if (
      item &&
      typeof item === "object" &&
      typeof (item as { value?: unknown }).value === "string"
    ) {
      const type = (item as { type?: unknown }).type;
      out.push({
        type: REDIRECT_URI_MATCH_TYPES.includes(type as RedirectUriMatchType)
          ? (type as RedirectUriMatchType)
          : "equals",
        value: (item as { value: string }).value,
      });
    }
  }
  return out;
}

/**
 * Returns null if the uri is acceptable as an `equals` registration value,
 * otherwise a rejection reason key (see RedirectUriReason).
 */
/** Why a redirect URI was refused. Routes answer with the error code
 *  `redirect_uri_<reason>`; dynamic client registration puts the key in its
 *  RFC 7591 error_description. */
export type RedirectUriReason =
  | "missing"
  | "not_url"
  | "userinfo"
  | "fragment"
  | "scheme"
  | "whitespace"
  | "regex"
  | "match_type"
  | "wildcard_host";

export function validateRedirectUriForRegistration(
  uri: string,
): RedirectUriReason | null {
  if (typeof uri !== "string" || !uri) return "missing";
  const parsed = tryParse(uri);
  if (!parsed) return "not_url";
  if (parsed.username || parsed.password) return "userinfo";
  if (parsed.hash) return "fragment";
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(host)) return null;
  return "scheme";
}

/**
 * Validate a single registration entry by its match type. Returns null when
 * acceptable, otherwise a rejection reason key.
 */
export function validateRedirectUriEntry(
  entry: RedirectUriEntry,
): RedirectUriReason | null {
  if (!entry || typeof entry.value !== "string" || !entry.value)
    return "missing";
  switch (entry.type) {
    case "equals":
      return validateRedirectUriForRegistration(entry.value);
    case "wildcard": {
      if (/\s/.test(entry.value)) return "whitespace";
      if (entry.value.includes("#")) return "fragment";
      const parsed = parseWildcard(entry.value);
      if (typeof parsed === "string") return parsed;
      // The domain itself must be spelled out: `https://*.com/cb` would let
      // any .com site in.
      const host = parsed.host;
      if (host.includes("*")) {
        const labels = host.split(".");
        if (labels.length < 3 || labels.slice(-2).some((l) => l.includes("*")))
          return "wildcard_host";
      }
      return null;
    }
    case "regex": {
      try {
        new RegExp(entry.value);
      } catch {
        return "regex";
      }
      return null;
    }
    default:
      return "match_type";
  }
}

/**
 * Normalize a parsed URL into the tuple we compare on. Trailing-slash
 * differences and default-port noise are ignored; everything else is
 * preserved (the spec requires path + query parity).
 */
function normalizeKey(parsed: URL): string {
  const scheme = parsed.protocol;
  const host = parsed.hostname.toLowerCase();
  const port =
    parsed.port ||
    (scheme === "https:" ? "443" : scheme === "http:" ? "80" : "");
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${scheme}//${host}:${port}${path}${parsed.search}`;
}

/** A wildcard entry split the way a URL is: the host and port are matched
 *  on their own, so a `*` can never carry the match into another host. */
interface WildcardPattern {
  scheme: string;
  /** Lowercased host glob; `*` matches within one label. */
  host: string;
  /** Port digits, `*` for any port, or null for the scheme's default. */
  port: string | null;
  /** Path and query glob; `*` matches any run of characters. */
  rest: string;
}

function defaultPort(scheme: string): string {
  return scheme === "https:" ? "443" : scheme === "http:" ? "80" : "";
}

function parseWildcard(pattern: string): WildcardPattern | RedirectUriReason {
  const m = /^(https?):\/\/([^/?#]*)(.*)$/i.exec(pattern);
  if (!m) return "scheme";
  const [, scheme, authority, rest] = m;
  if (authority.includes("@")) return "userinfo";
  let host = authority;
  let port: string | null = null;
  const bracketed = /^(\[[^\]]*\])(?::(.*))?$/.exec(authority);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2] ?? null;
  } else if (authority.includes(":")) {
    const i = authority.lastIndexOf(":");
    host = authority.slice(0, i);
    port = authority.slice(i + 1);
  }
  if (port !== null && !/^(\d+|\*)$/.test(port)) return "not_url";
  // A `*` ending the host (`https://example.com*`) has always stood for
  // the path, which the old whole-string glob ran on into. It is read that
  // way, so the host is exactly example.com and never example.community.
  // With a port or path after it, it could only mean more host: refused.
  if (host.endsWith("*")) {
    if (port !== null || rest) return "wildcard_host";
    host = host.slice(0, -1);
  }
  // The host must be a real one with the stars filled in, and more than
  // stars and dots: `https://*/cb` would accept every site.
  if (!/[^*.]/.test(host)) return "wildcard_host";
  const filled = tryParse(`${scheme}://${host.replaceAll("*", "x")}/`);
  if (!filled || filled.hostname !== host.replaceAll("*", "x").toLowerCase())
    return "wildcard_host";
  // Nothing after the host: a `*` ending the host (`http://localhost:*`,
  // `https://example.com*`) has always also covered the path, so keep that;
  // otherwise only the root. A query with no path is the root's query.
  let path = rest;
  if (!path) path = authority.endsWith("*") ? "*" : "/";
  else if (path.startsWith("?")) path = `/${path}`;
  return {
    scheme: `${scheme.toLowerCase()}:`,
    host: host.toLowerCase(),
    port,
    rest: path,
  };
}

/** Glob match where `*` stands for any run of characters. It only ever
 *  backtracks to the last `*`, so no pattern can make it run away. */
function globMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (pattern[p] === "*") {
      star = p++;
      mark = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

/** A host glob: `*` matches letters, digits and hyphens, never a dot. */
function hostMatches(pattern: string, host: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\*/g, "[a-z0-9-]*")}$`).test(host);
}

function wildcardMatches(pattern: string, candidate: URL): boolean {
  const w = parseWildcard(pattern);
  if (typeof w === "string") return false;
  if (candidate.protocol !== w.scheme) return false;
  if (!hostMatches(w.host, candidate.hostname.toLowerCase())) return false;
  const port = candidate.port || defaultPort(candidate.protocol);
  if (w.port !== "*" && port !== (w.port ?? defaultPort(w.scheme)))
    return false;
  return globMatch(w.rest, `${candidate.pathname}${candidate.search}`);
}

function regexMatches(pattern: string, candidate: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(candidate);
  } catch {
    return false;
  }
}

/**
 * Returns true if `candidate` matches one of the `registered` entries.
 *
 * Every candidate first passes the safety gate (https/loopback, no userinfo,
 * no fragment) regardless of match type. An empty registry means the app is
 * in "learn" mode and accepts any safe candidate (the caller pins the first
 * one used). `equals` entries compare on the normalized URL tuple, `wildcard`
 * entries on its parts, and `regex` entries match against the raw candidate
 * string.
 */
export function redirectUriMatchesRegistered(
  candidate: string,
  registered: RedirectUriEntry[],
): boolean {
  if (validateRedirectUriForRegistration(candidate) !== null) return false;
  if (registered.length === 0) return true;
  const candidateUrl = tryParse(candidate)!;
  const candidateKey = normalizeKey(candidateUrl);
  for (const entry of registered) {
    if (entry.type === "equals") {
      if (validateRedirectUriForRegistration(entry.value) !== null) continue;
      if (normalizeKey(tryParse(entry.value)!) === candidateKey) return true;
    } else if (entry.type === "wildcard") {
      if (wildcardMatches(entry.value, candidateUrl)) return true;
    } else if (entry.type === "regex") {
      if (regexMatches(entry.value, candidate)) return true;
    }
  }
  return false;
}
