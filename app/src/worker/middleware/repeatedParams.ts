// RFC 6749 §3.1 and §3.2: authorization and token request parameters "MUST
// NOT be included more than once". A repeated parameter is ambiguous (which
// redirect_uri, which scope?), so the request is refused rather than letting
// one copy win silently.

import type { MiddlewareHandler } from "hono";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

/** Parameters an extension lets a request repeat: RFC 8707 `resource` and
 *  RFC 8693 `audience`. */
const REPEATABLE_PARAMS = new Set(["resource", "audience"]);

/** The first parameter `params` carries more than once, or null. */
export function findRepeatedParam(params: URLSearchParams): string | null {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (REPEATABLE_PARAMS.has(key)) continue;
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/** Answer a request that repeats a parameter with `invalid_request`. The query
 *  string and a form-encoded body count as one list, so a parameter sent once
 *  in each is repeated too. A JSON body is left alone: its parser has already
 *  kept one value per key. */
export const rejectRepeatedParams: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const params = new URL(c.req.url).searchParams;
  if (
    c.req.method === "POST" &&
    !(c.req.header("Content-Type") ?? "").includes("application/json")
  ) {
    // Hono caches the body, so the route can still read it afterwards.
    for (const [k, v] of new URLSearchParams(await c.req.text()))
      params.append(k, v);
  }
  const repeated = findRepeatedParam(params);
  if (repeated) {
    // RFC 6749 §5.1: token endpoint responses, errors included, are no-store.
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    return c.json(
      {
        error: "invalid_request",
        error_description: `${repeated} must not be included more than once`,
      },
      400,
    );
  }
  await next();
};
