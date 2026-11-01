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
//   • wildcard — a glob where `*` stands in for any run of characters.
//                Matched against the raw candidate after a safety gate.
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type RedirectUriMatchType = "equals" | "regex" | "wildcard";

export interface RedirectUriEntry {
  type: RedirectUriMatchType;
  value: string;
}

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
        type:
          type === "regex" || type === "wildcard" || type === "equals"
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
  | "match_type";

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
      if (!/^https:\/\//i.test(entry.value) && !/^http:\/\//i.test(entry.value))
        return "scheme";
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

/** Convert a glob (`*` → any run of characters) into an anchored RegExp. */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\*/g, ".*")}$`);
}

function wildcardMatches(pattern: string, candidate: string): boolean {
  try {
    return wildcardToRegExp(pattern).test(candidate);
  } catch {
    return false;
  }
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
 * one used). `equals` entries compare on the normalized URL tuple; `wildcard`
 * and `regex` entries match against the raw candidate string.
 */
export function redirectUriMatchesRegistered(
  candidate: string,
  registered: RedirectUriEntry[],
): boolean {
  if (validateRedirectUriForRegistration(candidate) !== null) return false;
  if (registered.length === 0) return true;
  const candidateKey = normalizeKey(tryParse(candidate)!);
  for (const entry of registered) {
    if (entry.type === "equals") {
      if (validateRedirectUriForRegistration(entry.value) !== null) continue;
      if (normalizeKey(tryParse(entry.value)!) === candidateKey) return true;
    } else if (entry.type === "wildcard") {
      if (wildcardMatches(entry.value, candidate)) return true;
    } else if (entry.type === "regex") {
      if (regexMatches(entry.value, candidate)) return true;
    }
  }
  return false;
}
