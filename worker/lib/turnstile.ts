// Turnstile challenge endpoint and widget selection.
//
// Cloudflare serves Turnstile from two hosts: the global
// challenges.cloudflare.com and a Mainland-China host,
// challenges.cloudflare-cn.com. Which one the *browser* uses is configurable
// per site (turnstile_endpoint_mode). The server resolves the region-based
// server-side mode here — it has the request geolocation — while the remaining
// client-side modes are passed through for the browser to resolve.
//
// ─── The two hosts need two widgets ─────────────────────────────────────────
//
// The hosts are not interchangeable. Every Turnstile widget carries a `region`
// chosen at creation, "world" or "china", and a widget only works on the host
// matching its region: the China host answers HTTP 400 for a region:"world"
// sitekey (the widget reports "[Cloudflare Turnstile] Error: 400020" and the
// form it guards can never be submitted), and only Cloudflare's hardcoded test
// keys work on both. `region` is immutable — the API rejects a change with
// "you cannot change region" — so an existing global sitekey can never be
// promoted; a China widget has to be created as one. That in turn needs an
// entitlement ordinary accounts lack ("not entitled to create widgets with
// this `region`"), which comes with a China Network contract.
//
// So routing a visitor to the China host means switching the *sitekey* too,
// which is why turnstile_china_site_key / turnstile_china_secret_key exist
// beside the global pair. With no China sitekey configured, every mode
// collapses to "global" — that is the safe reading of "China requested but not
// possible", and it keeps sign-in working for operators who pick a
// China-leaning mode without holding the entitlement.
//
// The choice cannot be revisited in the browser: the Turnstile bundle captures
// its challenge origin once, at script-eval time, from the <script> tag that
// loaded it, and the `base-url` parameter that would override it is gated
// behind a flag the production bundle passes as a literal false. A widget that
// has loaded from the wrong host cannot be redirected without a page reload,
// so the decision has to be right before the browser commits to it.
//
// ─── Why the China widget is probed ─────────────────────────────────────────
//
// A configured China sitekey is trusted only after it answers: one request to
// the China host's own challenge endpoint for that sitekey, anything other
// than 200 downgrading the directive to "global". This catches a sitekey typed
// into the wrong field, a widget that was actually created region:"world", and
// an entitlement that lapsed. The probe never blocks a visitor — a cache miss
// serves "global" and refreshes in the background — and the verdict is cached
// in KV, so a working China widget costs one subrequest every few hours.

import type { SiteConfig, TurnstileEndpointMode } from "../types";
import { getGeo } from "./geo";

/** Directive sent to the browser. The server has already collapsed
 *  "server_region" into a concrete "global"/"china"; the client-side modes
 *  pass through for the browser to resolve against its own environment. */
export type TurnstileEndpointDirective =
  "global" | "china" | "client_language" | "client_region";

/** Which of the two configured widgets minted a token. Travels with the token
 *  from the browser so the server verifies against the matching secret. */
export type TurnstileVariant = "global" | "china";

/** What a public payload needs in order to render the right widget: the host
 *  strategy, plus the China sitekey when — and only when — the browser may
 *  actually need it. */
export interface TurnstileEndpointInfo {
  directive: TurnstileEndpointDirective;
  /** Empty unless `directive` can put this visitor on the China host. */
  chinaSiteKey: string;
}

const GLOBAL_ONLY: TurnstileEndpointInfo = {
  directive: "global",
  chinaSiteKey: "",
};

const CHINA_HOST = "https://challenges.cloudflare-cn.com";

const PROBE_KEY_PREFIX = "turnstile:cn-usable:";
/** A widget that works is unlikely to stop; re-check a few times a day. */
const PROBE_TTL_OK = 6 * 60 * 60;
/** Re-check a failing one hourly, so fixing the sitekey (or the entitlement
 *  landing) takes effect without a redeploy. */
const PROBE_TTL_BAD = 60 * 60;

/** The challenge platform varies its answer by client; ask as a browser would
 *  rather than as the default Workers fetch. */
const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * The China host's own challenge-creation URL for `siteKey`, in the shape the
 * Turnstile bundle builds it. Only the status code is read.
 *
 * These path segments are internal to Cloudflare's bundle and may drift. That
 * is safe by construction: a request that no longer matches answers non-200,
 * which reads as "unusable" and falls back to the global host — the host that
 * always works. Drift degrades the optimisation, never sign-in.
 */
function chinaProbeUrl(siteKey: string): string {
  return (
    `${CHINA_HOST}/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/ch2aa/` +
    `${encodeURIComponent(siteKey)}/auto/fbE/new/normal?lang=auto`
  );
}

/** Can the China host actually issue a challenge for this sitekey? */
async function probeChinaEndpoint(siteKey: string): Promise<boolean> {
  try {
    const res = await fetch(chinaProbeUrl(siteKey), {
      method: "GET",
      headers: { "User-Agent": PROBE_UA },
    });
    // Nothing in the body is needed; release the connection rather than
    // leaving the stream for the runtime to reclaim.
    await res.body?.cancel();
    return res.status === 200;
  } catch {
    // A host we cannot reach is a host we should not send a visitor to.
    return false;
  }
}

/**
 * Cached verdict for `siteKey`, refreshed out of band.
 *
 * A cache miss deliberately answers `false` instead of waiting on the network:
 * the global host is always a correct answer, and the login page must not pay
 * a round trip to Cloudflare to find out which widget to render.
 */
async function chinaWidgetUsable(
  env: Env,
  waitUntil: ((p: Promise<unknown>) => void) | null,
  siteKey: string,
): Promise<boolean> {
  if (!siteKey) return false;

  const key = `${PROBE_KEY_PREFIX}${siteKey}`;

  // This is a cache lookup on the path that renders the login page, so a KV
  // outage must not become a sign-in outage. Any failure reads as a miss,
  // which resolves to the global host — always a correct answer. No probe is
  // scheduled in that case: the write would be going to the same KV that just
  // failed to read.
  let cached: string | null;
  try {
    cached = await env.KV_CACHE.get(key);
  } catch {
    return false;
  }
  if (cached !== null) return cached === "1";

  // Swallow probe and write failures rather than letting them escape. The
  // caller has already fallen back to the global host, so the only thing lost
  // is the cached verdict — whereas an unhandled rejection would fail the
  // request outright on the awaited path below, and surface as a background
  // error on the waitUntil one.
  const refresh = probeChinaEndpoint(siteKey)
    .then((ok) =>
      env.KV_CACHE.put(key, ok ? "1" : "0", {
        expirationTtl: ok ? PROBE_TTL_OK : PROBE_TTL_BAD,
      }),
    )
    .catch(() => {});

  if (waitUntil) {
    waitUntil(refresh);
  } else {
    // No execution context to hand the work to (tests, some local adapters).
    // Awaiting costs this one request a round trip, which beats dropping the
    // probe and never populating the cache.
    await refresh;
  }
  return false;
}

/**
 * Collapse the admin-configured mode into the directive the browser receives.
 * `country` is the ISO 3166-1 alpha-2 country from the request's edge
 * geolocation (see lib/geo.ts), null when unknown — used only by
 * "server_region".
 */
function resolveTurnstileEndpoint(
  mode: TurnstileEndpointMode | undefined,
  country: string | null,
): TurnstileEndpointDirective {
  switch (mode) {
    case "china":
      return "china";
    case "client_language":
      return "client_language";
    case "client_region":
      return "client_region";
    case "server_region":
      return country === "CN" ? "china" : "global";
    case "global":
    default:
      return "global";
  }
}

/** Accepts anything with the request, bindings, and execution context — every
 *  Hono Context qualifies, and keeping it structural matches lib/geo.ts. */
type TurnstileContext = {
  req: { raw: Request };
  env: Env;
  executionCtx?: { waitUntil: (p: Promise<unknown>) => void };
};

// Hono throws from `c.executionCtx` when the adapter has none rather than
// returning undefined, so it has to be read defensively.
function execWaitUntil(
  c: TurnstileContext,
): ((p: Promise<unknown>) => void) | null {
  try {
    const ctx = c.executionCtx;
    return ctx ? ctx.waitUntil.bind(ctx) : null;
  } catch {
    return null;
  }
}

type TurnstileConfig = Pick<
  SiteConfig,
  "turnstile_endpoint_mode" | "captcha_provider" | "turnstile_china_site_key"
>;

/**
 * Host strategy and China sitekey for this request. Every public payload that
 * carries a Turnstile site key (site info, team-join info, OAuth 2FA info)
 * carries these alongside it, so the browser can render the widget that
 * matches the host it is about to load.
 *
 * Any directive that could put the browser on the China host — "china" now,
 * "client_language"/"client_region" once the browser resolves them — requires
 * a China sitekey that the host has confirmed it will serve. Otherwise the
 * browser is told "global" and the widget simply works.
 */
export async function turnstileEndpointFor(
  c: TurnstileContext,
  config: TurnstileConfig,
): Promise<TurnstileEndpointInfo> {
  // The directive is meaningless for the other providers, and probing with a
  // key that was never a Turnstile key would just burn a subrequest.
  if (config.captcha_provider !== "turnstile") return GLOBAL_ONLY;

  const directive = resolveTurnstileEndpoint(
    config.turnstile_endpoint_mode,
    getGeo(c).country,
  );
  if (directive === "global") return GLOBAL_ONLY;

  const chinaSiteKey = config.turnstile_china_site_key.trim();
  if (!chinaSiteKey) return GLOBAL_ONLY;

  const usable = await chinaWidgetUsable(c.env, execWaitUntil(c), chinaSiteKey);
  return usable ? { directive, chinaSiteKey } : GLOBAL_ONLY;
}
