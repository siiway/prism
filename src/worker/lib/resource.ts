// RFC 8707 Resource Indicators for OAuth 2.0.
//
// Clients may name the resource(s) an access token is intended for via one or
// more `resource` parameters. Each value must be an absolute URI without a
// fragment (§2). We record the accepted values with the grant and fold them
// into the token's `aud`, so a resource server can confirm the token was
// meant for it.

/**
 * Collect `resource` values from a parsed body. A form body may repeat the
 * parameter (URLSearchParams.getAll); a JSON body may send a string or an
 * array. Returns the raw candidate list (possibly empty).
 */
export function collectResourceParams(
  form: URLSearchParams | null,
  jsonValue: unknown,
): string[] {
  if (form) return form.getAll("resource").filter((v) => v.length > 0);
  if (typeof jsonValue === "string") return jsonValue ? [jsonValue] : [];
  if (Array.isArray(jsonValue))
    return jsonValue.filter((v): v is string => typeof v === "string" && !!v);
  return [];
}

/**
 * Validate resource indicators. Each must parse as an absolute URI and carry
 * no fragment component (RFC 8707 §2). Returns the de-duplicated list on
 * success, or null when any value is malformed — the caller answers with the
 * `invalid_target` error the RFC defines (§2, §3).
 */
export function validateResources(values: string[]): string[] | null {
  const out: string[] = [];
  for (const v of values) {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      return null; // not an absolute URI
    }
    if (u.hash) return null; // must not contain a fragment
    out.push(v);
  }
  return [...new Set(out)];
}

/** Serialize accepted resources for storage; null when there are none. */
export function serializeResources(resources: string[]): string | null {
  return resources.length ? JSON.stringify(resources) : null;
}

/** Parse a stored resource column back into a list (empty when null/invalid). */
export function parseResources(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
